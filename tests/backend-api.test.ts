import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { Storage } from '../server/storage.ts';
import { JobManager } from '../server/jobs.ts';
import { CodexAdapter } from '../server/codex.ts';
import { isLocalRequest } from '../server/security.ts';

test('local request guard rejects DNS rebinding and foreign origins', () => {
  assert.equal(isLocalRequest('127.0.0.1:4317', 'http://127.0.0.1:4317'), true);
  assert.equal(isLocalRequest('localhost:4317', 'http://127.0.0.1:4317'), true);
  for (const [host, origin, site] of [
    ['evil.test:4317', undefined, undefined],
    ['127.0.0.1:4317', 'https://evil.test', undefined],
    ['127.0.0.1:4317', 'null', undefined],
    ['127.0.0.1:4317', 'http://localhost:9000', undefined],
    ['127.0.0.1:4317', undefined, 'cross-site'],
  ])
    assert.equal(isLocalRequest(host, origin, site), false);
});
test('API validates bodies and emits terminal SSE snapshots', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const jobs = new JobManager(storage, async () => ({ documentId: 'd1', revisionId: 'r1' }));
  await jobs.init();
  const app = createApp({
    storage,
    jobs,
    cli: new CodexAdapter(join(root, 'runtime'), { executable: 'codex', timeout: 1000 }),
  });
  const badOrigin = await app.request('http://evil.test/api/documents');
  assert.equal(badOrigin.status, 403);
  const badJSON = await app.request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(badJSON.status, 400);
  const badQuestion = await app.request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(badQuestion.status, 400);
  const form = new FormData();
  form.set('text', 'S3 question');
  const response = await app.request('http://localhost/api/extract', {
    method: 'POST',
    body: form,
  });
  assert.equal(response.status, 202);
  const { job } = await response.json();
  const events = await app.request(`http://localhost/api/jobs/${job.id}/events`);
  const stream = await events.text();
  assert.match(stream, /event: job/);
  assert.match(stream, /"status":"completed"/);
  const unknown = await app.request('http://localhost/api/jobs/not-found');
  assert.equal(unknown.status, 404);
});
