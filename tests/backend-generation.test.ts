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

test('missing evaluations are completed once without changing the original model output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-completion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const original = structuredClone(demoDocument.revisions[0].explanation);
  original.evaluations = original.evaluations.slice(0, 1);
  const before = structuredClone(original);
  let explainCalls = 0,
    completionCalls = 0;
  const fake = {
    explain: async () => {
      explainCalls++;
      return { value: original, searched: false };
    },
    completeEvaluations: async (
      _question: QuestionDraft,
      explanation: typeof original,
      missing: string[],
    ) => {
      completionCalls++;
      assert.deepEqual(explanation, before);
      assert.deepEqual(missing, ['b', 'c']);
      return structuredClone(demoDocument.revisions[0].explanation.evaluations.slice(1).reverse());
    },
  } as unknown as CodexAdapter;
  const result = await createExecutor(storage, fake)(
    { kind: 'generate', question: demoDocument.question },
    new AbortController().signal,
    () => {},
    { jobId: 'completed-evaluations' },
  );
  assert.equal(explainCalls, 1);
  assert.equal(completionCalls, 1);
  assert.deepEqual(original, before);
  const diagnostic = await storage.readJson<{
    rawOutput: typeof original;
    completedOutput: typeof original;
    completion: {
      requestedOptionIds: string[];
      status: string;
      rawOutput: typeof original.evaluations;
    };
  }>('diagnostics', 'completed-evaluations');
  assert.deepEqual(diagnostic.rawOutput, before);
  assert.deepEqual(diagnostic.completedOutput.evaluations[0], before.evaluations[0]);
  for (const field of [
    'requirements',
    'architectures',
    'sources',
    'answerOptionIds',
    'answerRationale',
  ] as const)
    assert.deepEqual(diagnostic.completedOutput[field], before[field]);
  assert.deepEqual(diagnostic.completion.requestedOptionIds, ['b', 'c']);
  assert.equal(diagnostic.completion.status, 'completed');
  assert.deepEqual(
    diagnostic.completedOutput.evaluations.map((e) => e.optionId),
    ['a', 'b', 'c'],
  );
  assert.equal(
    (await storage.document(result.documentId!)).revisions[0].explanation.evaluations.length,
    3,
  );
});

test('completion cannot replace an existing evaluation, omit requested options, or repeat forever', async (t) => {
  for (const returnedIndices of [[], [1, 1], [0, 2]]) {
    const root = await mkdtemp(join(tmpdir(), 'question-lab-completion-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const storage = new Storage(root);
    await storage.init();
    const original = structuredClone(demoDocument.revisions[0].explanation);
    original.evaluations = original.evaluations.slice(0, 1);
    let completionCalls = 0;
    const fake = {
      explain: async () => ({ value: original, searched: false }),
      completeEvaluations: async () => {
        completionCalls++;
        return returnedIndices.map((index) =>
          structuredClone(demoDocument.revisions[0].explanation.evaluations[index]),
        );
      },
    } as unknown as CodexAdapter;
    await assert.rejects(
      createExecutor(storage, fake)(
        { kind: 'generate', question: demoDocument.question },
        new AbortController().signal,
        () => {},
        { jobId: 'invalid-completion' },
      ),
      (error: unknown) => (error as { code?: string }).code === 'INVALID_REFERENCES',
    );
    assert.equal(completionCalls, 1);
    assert.deepEqual(await storage.documents(), []);
    const diagnostic = await storage.readJson<{
      status: string;
      completion: { status: string; rawOutput: unknown[] };
    }>('diagnostics', 'invalid-completion');
    assert.equal(diagnostic.status, 'failed');
    assert.equal(diagnostic.completion.status, 'failed');
    assert.equal(diagnostic.completion.rawOutput.length, returnedIndices.length);
  }
});

test('completion output still undergoes semantic reference validation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-completion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const original = structuredClone(demoDocument.revisions[0].explanation);
  const added = original.evaluations.splice(1);
  added[0].checks[0].sourceIds = ['fabricated-source'];
  const fake = {
    explain: async () => ({ value: original, searched: false }),
    completeEvaluations: async () => added,
  } as unknown as CodexAdapter;
  await assert.rejects(
    createExecutor(storage, fake)(
      { kind: 'generate', question: demoDocument.question },
      new AbortController().signal,
      () => {},
    ),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_REFERENCES',
  );
  assert.deepEqual(await storage.documents(), []);
});

test('fresh matching diagnostics resume incomplete output and recheck official sources', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const rawOutput = structuredClone(demoDocument.revisions[0].explanation);
  rawOutput.evaluations = rawOutput.evaluations.slice(0, 1);
  const rawCreatedAt = new Date(Date.now() - 120000).toISOString();
  const createdAt = new Date(Date.now() - 60000).toISOString();
  await storage.writeJson('diagnostics', 'previous-partial', {
    question: demoDocument.question,
    rawOutput,
    searched: true,
    createdAt,
    rawCreatedAt,
  });
  let fetchCalls = 0,
    completionCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls++;
    return new Response(rawOutput.sources.map((source) => source.excerpt).join('\n'), {
      headers: { 'content-type': 'text/plain' },
    });
  });
  const fake = {
    explain: async () => {
      throw new Error('full research must not rerun');
    },
    completeEvaluations: async (_question: QuestionDraft, explanation: typeof rawOutput) => {
      completionCalls++;
      assert.equal(
        explanation.evaluations.length,
        1,
        'validation-only placeholder evaluations must not reach the model',
      );
      assert.deepEqual(explanation.evaluations[0], rawOutput.evaluations[0]);
      return structuredClone(demoDocument.revisions[0].explanation.evaluations.slice(1));
    },
  } as unknown as CodexAdapter;
  const result = await createExecutor(storage, fake)(
    { kind: 'generate', question: demoDocument.question, resumeDiagnosticId: 'previous-partial' },
    new AbortController().signal,
    () => {},
    { jobId: 'resumed-job' },
  );
  assert.equal(completionCalls, 1);
  assert.equal(fetchCalls, rawOutput.sources.length);
  const document = await storage.document(result.documentId!);
  assert.ok(
    document.revisions[0].explanation.sources.every((source) => source.status === 'verified'),
  );
  const diagnostic = await storage.readJson<{
    rawCreatedAt: string;
    rawOutput: typeof rawOutput;
    resumedFrom: { diagnosticId: string; createdAt: string; rawCreatedAt: string };
  }>('diagnostics', 'resumed-job');
  assert.deepEqual(diagnostic.rawOutput, rawOutput);
  assert.equal(diagnostic.rawCreatedAt, rawCreatedAt);
  assert.deepEqual(diagnostic.resumedFrom, {
    diagnosticId: 'previous-partial',
    createdAt,
    rawCreatedAt,
  });
});

test('expired, changed, malformed, and future diagnostics require fresh generation', async (t) => {
  const cases = [
    { createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() },
    { rawCreatedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() },
    { question: { ...demoDocument.question, text: `${demoDocument.question.text} 条件を変更` } },
    { rawOutput: { title: 'incomplete schema' } },
    { createdAt: new Date(Date.now() + 60000).toISOString() },
    { createdAt: 'invalid date' },
    { searched: 'true' },
  ];
  for (const override of cases) {
    const root = await mkdtemp(join(tmpdir(), 'question-lab-resume-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const storage = new Storage(root);
    await storage.init();
    await storage.writeJson('diagnostics', 'unusable-diagnostic', {
      question: demoDocument.question,
      rawOutput: demoDocument.revisions[0].explanation,
      searched: true,
      createdAt: new Date().toISOString(),
      ...override,
    });
    let explainCalls = 0;
    const fake = {
      explain: async () => {
        explainCalls++;
        return { value: structuredClone(demoDocument.revisions[0].explanation), searched: false };
      },
      completeEvaluations: async () => {
        throw new Error('not missing evaluations');
      },
    } as unknown as CodexAdapter;
    await createExecutor(storage, fake)(
      {
        kind: 'generate',
        question: demoDocument.question,
        resumeDiagnosticId: 'unusable-diagnostic',
      },
      new AbortController().signal,
      () => {},
      { jobId: 'fresh-job' },
    );
    assert.equal(explainCalls, 1);
    const diagnostic = await storage.readJson<{ resumedFrom?: unknown }>(
      'diagnostics',
      'fresh-job',
    );
    assert.equal(diagnostic.resumedFrom, undefined);
  }
});

for (const missingEvaluations of [false, true]) {
  test(`semantic errors require fresh generation even with ${missingEvaluations ? 'incomplete' : 'complete'} evaluations`, async (t) => {
    const mutations = [
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.requirements[0].quote = '存在しない問題文の引用';
      },
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.evaluations[0].checks[0].sourceIds = ['nonexistent-source'];
      },
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.evaluations[0].checks[0].requirementId = 'nonexistent-requirement';
      },
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.architectures[0].edges[0].to = 'nonexistent-endpoint';
      },
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.evaluations[0].architectureId = 'graph-b';
      },
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.answerOptionIds = ['nonexistent-answer'];
      },
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.evaluations.push(structuredClone(raw.evaluations[0]));
      },
      (raw: (typeof demoDocument.revisions)[0]['explanation']) => {
        raw.evaluations[0].checks = [];
      },
    ];
    for (const mutate of mutations) {
      const root = await mkdtemp(join(tmpdir(), 'question-lab-semantic-resume-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const storage = new Storage(root);
      await storage.init();
      const rawOutput = structuredClone(demoDocument.revisions[0].explanation);
      if (missingEvaluations) rawOutput.evaluations = rawOutput.evaluations.slice(0, 1);
      mutate(rawOutput);
      await storage.writeJson('diagnostics', 'semantic-error', {
        question: demoDocument.question,
        rawOutput,
        searched: false,
        createdAt: new Date().toISOString(),
        error: { code: 'INVALID_REFERENCES', message: 'Unrepairable semantic error' },
      });
      let explainCalls = 0,
        completionCalls = 0;
      const fake = {
        explain: async () => {
          explainCalls++;
          return { value: structuredClone(demoDocument.revisions[0].explanation), searched: false };
        },
        completeEvaluations: async () => {
          completionCalls++;
          throw new Error('must not resume a semantic error');
        },
      } as unknown as CodexAdapter;
      await createExecutor(storage, fake)(
        { kind: 'generate', question: demoDocument.question, resumeDiagnosticId: 'semantic-error' },
        new AbortController().signal,
        () => {},
        { jobId: 'fresh-after-semantic-error' },
      );
      assert.equal(explainCalls, 1);
      assert.equal(completionCalls, 0);
      const next = await storage.readJson<{ resumedFrom?: unknown }>(
        'diagnostics',
        'fresh-after-semantic-error',
      );
      assert.equal(next.resumedFrom, undefined);
      const previous = await storage.readJson<{ rawOutput: typeof rawOutput }>(
        'diagnostics',
        'semantic-error',
      );
      assert.deepEqual(
        previous.rawOutput,
        rawOutput,
        'resume eligibility checking must not change stored raw output',
      );
    }
  });
}

test('a repairable display-link error can still resume without a model call', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-display-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new Storage(root);
  await storage.init();
  const rawOutput = structuredClone(demoDocument.revisions[0].explanation);
  rawOutput.evaluations[0].checks[0].edgeIds = ['display-typo'];
  await storage.writeJson('diagnostics', 'repairable-display', {
    question: demoDocument.question,
    rawOutput,
    searched: false,
    createdAt: new Date().toISOString(),
  });
  const fake = {
    explain: async () => {
      throw new Error('repairable output should resume');
    },
    completeEvaluations: async () => {
      throw new Error('no missing evaluations');
    },
  } as unknown as CodexAdapter;
  const result = await createExecutor(storage, fake)(
    { kind: 'generate', question: demoDocument.question, resumeDiagnosticId: 'repairable-display' },
    new AbortController().signal,
    () => {},
    { jobId: 'resumed-display' },
  );
  const explanation = (await storage.document(result.documentId!)).revisions[0].explanation;
  assert.deepEqual(explanation.evaluations[0].checks[0].edgeIds, ['a-query']);
  const diagnostic = await storage.readJson<{
    rawOutput: typeof rawOutput;
    resumedFrom: { diagnosticId: string };
  }>('diagnostics', 'resumed-display');
  assert.deepEqual(diagnostic.rawOutput, rawOutput);
  assert.equal(diagnostic.resumedFrom.diagnosticId, 'repairable-display');
});
