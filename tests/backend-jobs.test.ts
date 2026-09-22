import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../server/storage.ts';
import { JobManager, isTerminal, type JobPayload } from '../server/jobs.ts';
import { AppError } from '../server/errors.ts';
import type { GenerationJob } from '../shared/schema.ts';
import { demoDocument } from '../shared/demo.ts';

const payload: JobPayload = {
  kind: 'extract',
  text: 'AWS question',
  knownAnswer: '',
  originalExplanation: '',
  imageIds: [],
};
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Storage(root);
  await store.init();
  return store;
}
async function terminal(manager: JobManager, id: string): Promise<GenerationJob> {
  if (isTerminal(manager.get(id).status) && manager.activeJobId !== id) return manager.get(id);
  return new Promise((resolve) => {
    const off = manager.subscribe(id, (job) => {
      if (isTerminal(job.status)) {
        off();
        resolve(job);
      }
    });
  });
}
test('single active generation, cancellation and durable retry', async (t) => {
  const store = await setup(t);
  const manager = new JobManager(store, async (_input, signal) => {
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
    throw new AppError('CANCELLED', 'cancel');
  });
  await manager.init();
  const first = await manager.start(payload);
  await assert.rejects(
    manager.start(payload),
    (e: unknown) => e instanceof AppError && e.code === 'BUSY',
  );
  manager.cancel(first.id);
  assert.equal((await terminal(manager, first.id)).status, 'cancelled');
  const reloaded = new JobManager(store, async () => ({
    documentId: 'retry-result',
    revisionId: 'r1',
  }));
  await reloaded.init();
  const retry = await reloaded.retry(first.id);
  assert.notEqual(retry.id, first.id);
  assert.equal((await terminal(reloaded, retry.id)).result?.documentId, 'retry-result');
  assert.equal(reloaded.activeJobId, null);
});
test('restart converts interrupted jobs into retryable failures', async (t) => {
  const store = await setup(t);
  await store.writeJson('jobs', 'running-job', {
    payload,
    job: {
      id: 'running-job',
      kind: 'extract',
      status: 'running',
      stage: 'thinking',
      message: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  });
  const manager = new JobManager(store, async () => ({}));
  await manager.init();
  assert.equal(manager.get('running-job').status, 'failed');
  assert.equal(manager.get('running-job').error?.code, 'INTERRUPTED');
  assert.equal(manager.activeJobId, null);
});
test('retry passes the failed diagnostic only for reference failures', async (t) => {
  const store = await setup(t);
  const inputs: JobPayload[] = [];
  const manager = new JobManager(store, async (input) => {
    inputs.push(input);
    if (inputs.length === 1) throw new AppError('INVALID_REFERENCES', 'incomplete evaluation');
    return { documentId: 'recovered', revisionId: 'r1' };
  });
  await manager.init();
  const first = await manager.start({ kind: 'generate', question: demoDocument.question });
  assert.equal((await terminal(manager, first.id)).error?.code, 'INVALID_REFERENCES');
  const retry = await manager.retry(first.id);
  assert.equal((await terminal(manager, retry.id)).status, 'completed');
  assert.deepEqual(inputs[1], {
    kind: 'generate',
    question: demoDocument.question,
    resumeDiagnosticId: first.id,
  });
});
test('a cancel after the document commit preserves the successful result and prevents duplicate retry', async (t) => {
  const store = await setup(t);
  let committed!: () => void;
  const commitReady = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const manager = new JobManager(store, async (_payload, signal) => {
    await store.saveDocument(demoDocument);
    committed();
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    return { documentId: demoDocument.id, revisionId: demoDocument.revisions[0].id };
  });
  await manager.init();
  const job = await manager.start({ kind: 'generate', question: demoDocument.question });
  await commitReady;
  manager.cancel(job.id);
  const done = await terminal(manager, job.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.result?.documentId, demoDocument.id);
  assert.throws(
    () => manager.retry(job.id),
    (e: unknown) => e instanceof AppError && e.code === 'NOT_RETRYABLE',
  );
  assert.equal((await store.documents()).length, 1);
});
test('actual progress is bounded, persisted and restored without duplicate adjacent events', async (t) => {
  const store = await setup(t);
  let executionId: string | undefined;
  const manager = new JobManager(store, async (_payload, _signal, progress, context) => {
    executionId = context?.jobId;
    for (let n = 0; n < 45; n++) {
      progress('research', `検索結果 ${n}`);
      progress('research', `検索結果 ${n}`);
    }
    progress('validating', '関連付けを確認');
    return { documentId: 'generated', revisionId: 'r1' };
  });
  await manager.init();
  const started = await manager.start(payload);
  const result = await terminal(manager, started.id);
  assert.equal(executionId, started.id);
  assert.equal(result.activity?.length, 40);
  assert.equal(result.activity?.at(-1)?.stage, 'completed');
  assert.equal(result.activity?.filter((event) => event.message === '検索結果 44').length, 1);
  const restored = new JobManager(store, async () => ({}));
  await restored.init();
  assert.deepEqual(restored.get(started.id).activity, result.activity);
});
test('storage validates opaque IDs, MIME signatures and restores documents', async (t) => {
  const store = await setup(t);
  await assert.rejects(store.image('../../config'));
  await assert.rejects(store.saveImage(Buffer.from('<svg onload="bad()"/>'), 'image/png'));
  const image = await store.saveImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png');
  assert.equal((await store.image(image)).type, 'image/png');
  await store.saveDocument(demoDocument);
  assert.equal((await store.document(demoDocument.id)).id, demoDocument.id);
  assert.equal((await store.documents()).length, 1);
});
test('deleting a document removes its jobs and unreferenced uploads', async (t) => {
  const store = await setup(t);
  const imageId = await store.saveImage(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'image/png',
  );
  const document = structuredClone(demoDocument);
  document.question.imageIds = [imageId];
  document.revisions[0].question.imageIds = [imageId];
  await store.saveDocument(document);
  const manager = new JobManager(store, async () => ({
    documentId: document.id,
    revisionId: document.revisions[0].id,
  }));
  await manager.init();
  const job = await manager.start({ kind: 'generate', question: document.question });
  await terminal(manager, job.id);
  await store.writeJson('diagnostics', job.id, { raw: 'private generated explanation' });
  await manager.deleteDocument(document.id);
  assert.deepEqual(await store.documents(), []);
  assert.deepEqual(await store.listIds('jobs'), []);
  assert.deepEqual(await store.listIds('diagnostics'), []);
  await assert.rejects(store.image(imageId));
});
