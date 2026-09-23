import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_MODEL } from '../shared/schema.ts';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { Storage } from './storage.ts';
import { CodexAdapter, readCliSettings } from './codex.ts';
import { JobManager } from './jobs.ts';
import { createExecutor } from './generation.ts';
import { appRoot, dataRoot } from './paths.ts';
import { isLocalRequest } from './security.ts';

const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORTは1〜65535の整数を指定してください。');
const storage = new Storage(dataRoot);
await storage.init();
const settings = await readCliSettings();
settings.model = await storage.selectedModel(settings.model || DEFAULT_MODEL);
const cli = new CodexAdapter(join(dataRoot, 'runtime'), settings);
const jobs = new JobManager(storage, createExecutor(storage, cli));
await jobs.init();
const app = createApp({ storage, cli, jobs });
const dev = process.argv.includes('--dev');
const vite = dev
  ? await (
      await import('vite')
    ).createServer({
      root: appRoot,
      server: {
        host: '127.0.0.1',
        middlewareMode: true,
        hmr: { host: '127.0.0.1' },
        fs: {
          deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/server/**'],
        },
      },
      appType: 'custom',
    })
  : null;
if (!dev) app.use('*', serveStatic({ root: join(appRoot, 'dist/client') }));
app.get('*', async (c) => {
  try {
    const template = await readFile(
      join(appRoot, dev ? 'index.html' : 'dist/client/index.html'),
      'utf8',
    );
    return c.html(vite ? await vite.transformIndexHtml(c.req.path, template) : template);
  } catch {
    return c.text('画面を読み込めません。npm run build を実行してください。', 503);
  }
});
const listener = getRequestListener(app.fetch);
const server = createServer((request, response) => {
  if (
    !isLocalRequest(
      request.headers.host,
      typeof request.headers.origin === 'string' ? request.headers.origin : null,
      typeof request.headers['sec-fetch-site'] === 'string'
        ? request.headers['sec-fetch-site']
        : null,
    )
  ) {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: { code: 'FORBIDDEN_ORIGIN', message: 'ローカルの画面から利用してください。' },
      }),
    );
    return;
  }
  if (vite && !request.url?.startsWith('/api/'))
    vite.middlewares(request, response, () => {
      void listener(request, response);
    });
  else void listener(request, response);
});
server.on('error', (error) => {
  console.error(
    `起動できません: ${(error as NodeJS.ErrnoException).code || 'サーバーエラー'}。PORTまたは起動済みのアプリを確認してください。`,
  );
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`AWS Question Lab: http://127.0.0.1:${port}`);
});
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await jobs.shutdown();
  await vite?.close();
  server.close();
  server.closeAllConnections();
};
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
