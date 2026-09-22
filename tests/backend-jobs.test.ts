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
  await manager.deleteDocument(document.id);
  assert.deepEqual(await store.documents(), []);
  assert.deepEqual(await store.listIds('jobs'), []);
  await assert.rejects(store.image(imageId));
});
