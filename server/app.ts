import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { QuestionDraftSchema, Id, validateQuestion, type GenerationJob } from '../shared/schema.ts';
import { Storage } from './storage.ts';
import { JobManager, isTerminal } from './jobs.ts';
import { CodexAdapter } from './codex.ts';
import { AppError, publicError } from './errors.ts';
import { isLocalRequest } from './security.ts';

export type AppDependencies = { storage: Storage; jobs: JobManager; cli: CodexAdapter };
function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      'INVALID_INPUT',
      '入力内容を確認してください。必須項目・文字数・選択肢の形式が正しくありません。',
    );
  return parsed.data;
}

export function createApp({ storage, jobs, cli }: AppDependencies) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (
      !isLocalRequest(
        c.req.header('host') || new URL(c.req.url).host,
        c.req.header('origin'),
        c.req.header('sec-fetch-site'),
      )
    )
      return c.json(
        {
          error: {
            code: 'FORBIDDEN_ORIGIN',
            message: 'このアプリはローカルの画面から利用してください。',
          },
        },
        403,
      );
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
    if (
      ['POST', 'PUT', 'PATCH'].includes(c.req.method) &&
      !/^(application\/json|multipart\/form-data)(;|$)/i.test(c.req.header('content-type') || '') &&
      !/^\/api\/jobs\/[^/]+\/(cancel|retry)$/.test(c.req.path)
    )
      return c.json(
        {
          error: {
            code: 'UNSUPPORTED_CONTENT_TYPE',
            message: 'JSONまたは画像フォームを送信してください。',
          },
        },
        415,
      );
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 52 * 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: 'BODY_TOO_LARGE',
              message: '送信内容が大きすぎます。画像は5枚まで、1枚10 MiBまでです。',
            },
          },
          413,
        ),
    }),
  );
  app.onError((error, c) => {
    const detail = publicError(error);
    const status =
      error instanceof AppError ? error.status : error instanceof SyntaxError ? 400 : 500;
    return c.json(
      error instanceof SyntaxError
        ? { error: { code: 'INVALID_JSON', message: 'JSONの形式が正しくありません。' } }
        : { error: detail },
      status as 400 | 404 | 409 | 500,
    );
  });
  app.get('/api/health', async (c) => c.json(await cli.health(jobs.activeJobId)));
  app.post('/api/extract', async (c) => {
    jobs.assertAvailable();
    const form = await c.req.formData();
    const text = form.get('text') || '',
      knownAnswer = form.get('knownAnswer') || '',
      originalExplanation = form.get('originalExplanation') || '';
    const input = validated(
      z.object({
        text: z.string().max(30000),
        knownAnswer: z.string().max(2000),
        originalExplanation: z.string().max(20000),
      }),
      { text, knownAnswer, originalExplanation },
    );
    const files = form.getAll('images');
    if (files.length > 5) throw new AppError('TOO_MANY_IMAGES', '画像は5枚まで追加できます。');
    if (!input.text.trim() && !files.length)
      throw new AppError('EMPTY_INPUT', '問題文または画像を入力してください。');
    const imageIds: string[] = [];
    for (const file of files) {
      if (typeof file === 'string')
        throw new AppError('INVALID_IMAGE', '画像ファイルを送信してください。');
      if (file.size > 10 * 1024 * 1024)
        throw new AppError('IMAGE_TOO_LARGE', '画像は1枚10 MiBまでです。');
      imageIds.push(await storage.saveImage(new Uint8Array(await file.arrayBuffer()), file.type));
    }
    return c.json({ job: await jobs.start({ kind: 'extract', ...input, imageIds }) }, 202);
  });
  app.post('/api/generate', async (c) => {
    jobs.assertAvailable();
    const { question } = validated(z.object({ question: QuestionDraftSchema }), await c.req.json());
    try {
      validateQuestion(question);
    } catch {
      throw new AppError(
        'INVALID_QUESTION',
        '選択肢・正解・選択数の組み合わせを確認してください。',
      );
    }
    await Promise.all(question.imageIds.map((id) => storage.image(id)));
    return c.json({ job: await jobs.start({ kind: 'generate', question }) }, 202);
  });
  app.post('/api/documents/:id/followups', async (c) => {
    jobs.assertAvailable();
    const document = await storage.document(c.req.param('id'));
    const input = validated(
      z.object({ revisionId: Id, prompt: z.string().trim().min(1).max(10000) }),
      await c.req.json(),
    );
    if (!document.revisions.some((r) => r.id === input.revisionId))
      throw new AppError('NOT_FOUND', '指定された解説の版が見つかりません。', 404);
    return c.json(
      { job: await jobs.start({ kind: 'followup', documentId: document.id, ...input }) },
      202,
    );
  });
  app.get('/api/jobs/:id', (c) => c.json({ job: jobs.get(c.req.param('id')) }));
  app.post('/api/jobs/:id/cancel', (c) => c.json({ job: jobs.cancel(c.req.param('id')) }));
  app.post('/api/jobs/:id/retry', async (c) =>
    c.json({ job: await jobs.retry(c.req.param('id')) }, 202),
  );
  app.get('/api/jobs/:id/events', (c) => {
    const id = c.req.param('id');
    jobs.get(id);
    return streamSSE(c, async (stream) => {
      let unsubscribe = () => {};
      let heartbeat: NodeJS.Timeout | undefined;
      let settled = false;
      await new Promise<void>((resolve) => {
        let writes = Promise.resolve();
        const finish = () => {
          if (settled) return;
          settled = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          resolve();
        };
        const emit = (job: GenerationJob) => {
          writes = writes
            .then(async () => {
              if (settled) return;
              await stream.writeSSE({ event: 'job', data: JSON.stringify(job) });
              if (isTerminal(job.status)) finish();
            })
            .catch(finish);
        };
        unsubscribe = jobs.subscribe(id, emit);
        stream.onAbort(finish);
        emit(jobs.get(id));
        heartbeat = setInterval(() => {
          writes = writes
            .then(async () => {
              if (!settled) await stream.writeSSE({ event: 'ping', data: '{}' });
            })
            .catch(finish);
        }, 15000);
      });
    });
  });
  app.get('/api/documents', async (c) => c.json({ documents: await storage.documents() }));
  app.get('/api/documents/:id', async (c) =>
    c.json({ document: await storage.document(c.req.param('id')) }),
  );
  app.delete('/api/documents/:id', async (c) => {
    await jobs.deleteDocument(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/api/images/:id', async (c) => {
    const image = await storage.image(c.req.param('id'));
    c.header('Content-Type', image.type);
    return c.body(new Uint8Array(image.bytes));
  });
  app.get('/api/documents/:id/export', async (c) => {
    const document = await storage.document(c.req.param('id'));
    const revisionId = c.req.query('revisionId');
    if (revisionId && !document.revisions.some((r) => r.id === revisionId))
      throw new AppError('NOT_FOUND', '指定された解説の版が見つかりません。', 404);
    const { renderExport } = await import('./export.ts');
    const html = await renderExport(document, revisionId);
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="aws-question-${document.id}.html"`);
    return c.body(html);
  });
  app.all('/api/*', (c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'APIが見つかりません。' } }, 404),
  );
  return app;
}
