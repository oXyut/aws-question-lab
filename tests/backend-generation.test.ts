import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../server/storage.ts';
import { createExecutor } from '../server/generation.ts';
import { CodexAdapter } from '../server/codex.ts';
import { demoDocument } from '../shared/demo.ts';
import type { QuestionDraft } from '../shared/schema.ts';

test('follow-up generates a full new version and preserves its parent and original question', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-generation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  await storage.saveDocument(demoDocument);
  let effectiveQuestion: QuestionDraft | undefined;
  const fake = {
    explain: async (question: QuestionDraft) => {
      effectiveQuestion = question;
      return { value: structuredClone(demoDocument.revisions[0].explanation), searched: false };
    },
  } as unknown as CodexAdapter;
  const execute = createExecutor(storage, fake);
  const result = await execute(
    {
      kind: 'followup',
      documentId: demoDocument.id,
      revisionId: demoDocument.revisions[0].id,
      prompt: 'なぜBは比較上不利ですか？',
    },
    new AbortController().signal,
    () => {},
  );
  const document = await storage.document(result.documentId!);
  assert.equal(document.revisions.length, 2);
  assert.deepEqual(document.question, demoDocument.question);
  assert.deepEqual(document.revisions[0], demoDocument.revisions[0]);
  assert.equal(document.revisions[1].parentRevisionId, demoDocument.revisions[0].id);
  assert.equal(document.revisions[1].id, result.revisionId);
  assert.ok(effectiveQuestion?.text.endsWith('なぜBは比較上不利ですか？'));
  assert.ok(document.revisions[1].explanation.sources.every((s) => s.status === 'unverified'));
  assert.ok(document.revisions[1].explanation.evaluations.every((e) => e.overall === 'unknown'));
});

test('invalid reference output is rejected before persistence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-generation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const explanation = structuredClone(demoDocument.revisions[0].explanation);
  explanation.requirements[0].quote = '問題文に存在しない引用';
  const fake = {
    explain: async () => ({ value: explanation, searched: false }),
  } as unknown as CodexAdapter;
  await assert.rejects(
    createExecutor(storage, fake)(
      { kind: 'generate', question: demoDocument.question },
      new AbortController().signal,
      () => {},
      { jobId: 'rejected-reference-job' },
    ),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_REFERENCES',
  );
  assert.deepEqual(await storage.documents(), []);
  const diagnostic = await storage.readJson<{
    status: string;
    jobId: string;
    rawOutput: typeof explanation;
    repairedOutput: typeof explanation;
    error: { code: string; message: string };
  }>('diagnostics', 'rejected-reference-job');
  assert.equal(diagnostic.status, 'failed');
  assert.equal(diagnostic.jobId, 'rejected-reference-job');
  assert.deepEqual(diagnostic.rawOutput, explanation);
  assert.deepEqual(diagnostic.repairedOutput, explanation);
  assert.equal(diagnostic.error.code, 'INVALID_REFERENCES');
  assert.match(diagnostic.error.message, /引用が問題文にありません/);
});

test('generation repairs display links once, retains raw diagnostics and publishes validated output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-generation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const explanation = structuredClone(demoDocument.revisions[0].explanation);
  explanation.evaluations[0].checks[0].edgeIds = ['invalid-display-edge'];
  explanation.evaluations[0].checks[0].nodeIds = ['b-engine'];
  let calls = 0;
  const fake = {
    explain: async () => {
      calls++;
      return { value: explanation, searched: false };
    },
  } as unknown as CodexAdapter;
  const stages: string[] = [];
  const result = await createExecutor(storage, fake)(
    { kind: 'generate', question: demoDocument.question },
    new AbortController().signal,
    (stage) => {
      stages.push(stage);
    },
    { jobId: 'repaired-reference-job' },
  );
  assert.equal(calls, 1, 'repair must not make another model call');
  const saved = (await storage.document(result.documentId!)).revisions[0].explanation;
  assert.deepEqual(saved.evaluations[0].checks[0].edgeIds, ['a-query']);
  assert.deepEqual(saved.evaluations[0].checks[0].nodeIds, ['a-analyst', 'a-athena']);
  assert.ok(saved.caveats.some((caveat) => caveat.includes('図の表示リンクを修復')));
  assert.ok(stages.indexOf('validating') < stages.indexOf('repairing'));
  assert.ok(stages.indexOf('repairing') < stages.indexOf('verifying'));
  assert.equal(stages.at(-1), 'saving');
  const diagnostic = await storage.readJson<{
    status: string;
    jobId: string;
    rawOutput: typeof explanation;
    repairedOutput: typeof explanation;
    repairs: { removedIds: string[]; fallbackIds: string[] }[];
    result: typeof result;
  }>('diagnostics', 'repaired-reference-job');
  assert.equal(diagnostic.status, 'completed');
  assert.equal(diagnostic.jobId, 'repaired-reference-job');
  assert.deepEqual(diagnostic.rawOutput, explanation);
  assert.deepEqual(diagnostic.rawOutput.evaluations[0].checks[0].edgeIds, ['invalid-display-edge']);
  assert.deepEqual(diagnostic.repairedOutput.evaluations[0].checks[0].edgeIds, ['a-query']);
  assert.equal(diagnostic.repairs.length, 2);
  assert.deepEqual(diagnostic.result, result);
  assert.equal(
    (await stat(join(root, 'diagnostics', 'repaired-reference-job.json'))).mode & 0o777,
    0o600,
  );
});

test('extraction preserves uploaded image IDs and supplied original explanation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-generation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const imageId = await storage.saveImage(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'image/png',
  );
  const fake = {
    extract: async () => ({ value: structuredClone(demoDocument.question), searched: false }),
  } as unknown as CodexAdapter;
  const result = await createExecutor(storage, fake)(
    {
      kind: 'extract',
      imageIds: [imageId],
      text: '入力文',
      knownAnswer: 'A',
      originalExplanation: '利用者が入力した元解説',
    },
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(result.draft?.imageIds, [imageId]);
  assert.equal(result.draft?.originalExplanation, '利用者が入力した元解説');
});
