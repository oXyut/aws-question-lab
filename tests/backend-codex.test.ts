import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CodexAdapter,
  parseCliEvent,
  safeCliError,
  explanationOutputSchema,
  evaluationCompletionSchema,
  readCliSettings,
} from '../server/codex.ts';
import { demoDocument } from '../shared/demo.ts';
import { validateReferences, type ExplanationInput } from '../shared/schema.ts';

function requirementWire(explanation: ExplanationInput) {
  return {
    ...structuredClone(explanation),
    requirements: explanation.requirements.map((requirement) => ({
      ...structuredClone(requirement),
      checks: Object.fromEntries(explanation.evaluations.map((evaluation) => {
        const { requirementId: _id, nodeIds: _nodes, edgeIds: _edges, ...check } =
          evaluation.checks.find((check) => check.requirementId === requirement.id)!;
        return [evaluation.optionId, structuredClone(check)];
      })),
    })),
    evaluations: Object.fromEntries(
      explanation.evaluations.map(({ optionId, checks: _checks, ...evaluation }) => [
        optionId, structuredClone(evaluation),
      ]),
    ),
  };
}

test('study model defaults independently from Codex configuration and accepts app-specific overrides', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'config.toml'),
    'model = "configured-model"\nmodel_reasoning_effort = "high"\n[plugins]\nignored=true\n',
  );
  const defaults = await readCliSettings({ CODEX_HOME: root });
  assert.equal(defaults.model, 'gpt-6-luna');
  assert.equal(defaults.effort, 'low');
  const override = await readCliSettings({
    CODEX_HOME: root,
    CODEX_MODEL: 'gpt-6-astra',
    QUESTION_LAB_MODEL: 'gpt-6-sol',
    CODEX_REASONING_EFFORT: 'high',
  });
  assert.equal(override.model, 'gpt-6-sol');
  assert.equal(override.effort, 'high');
});

test('CLI parser handles observed search and final message events without treating commentary as JSON', () => {
  assert.deepEqual(parseCliEvent('not JSON'), {});
  assert.equal(
    parseCliEvent(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'web_search', action: { type: 'search', query: 'site:docs.aws.amazon.com' } },
      }),
    ).searched,
    true,
  );
  assert.equal(
    parseCliEvent(JSON.stringify({ type: 'item.started', item: { type: 'web_search' } })).searched,
    undefined,
  );
  assert.equal(
    parseCliEvent(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"answer":"A"}' },
      }),
    ).answer,
    '{"answer":"A"}',
  );
});
test('public CLI errors classify failures without exposing stderr', () => {
  assert.equal(safeCliError('Bearer private-secret: 401 unauthorized').code, 'AUTH_REQUIRED');
  assert.ok(!safeCliError('Bearer private-secret').message.includes('private-secret'));
  assert.equal(safeCliError('usage_limit_reached').code, 'USAGE_LIMIT');
  assert.equal(safeCliError('stream disconnected: network').code, 'NETWORK');
});
test('text-only extraction identifies absent optional inputs without asking the model to invent warnings or an answer', async () => {
  const input = {
    text: 'S3上のログをSQLで分析します。A. Athena B. EC2',
    knownAnswer: '',
    originalExplanation: '',
    images: [],
  };
  const extracted = {
    ...structuredClone(demoDocument.question),
    knownAnswerIds: [],
    uncertainties: [],
  };
  const adapter = new CodexAdapter('/unused', { executable: 'unused', timeout: 1000 });
  adapter.run = async (schema, prompt, images, research) => {
    assert.deepEqual(images, []);
    assert.equal(research, false);
    assert.match(prompt, /画像添付枚数（アプリが確認）: 0枚/);
    assert.match(prompt, /未添付であることだけを理由に画像の確認不能をuncertaintiesに記入しない/);
    assert.match(prompt, /資料に正解が明示されていなければknownAnswerIds=\[\]/);
    assert.match(prompt, /未入力・未記載をuncertaintiesに含めない/);
    assert.match(prompt, /正解を自分で解いて補完しない/);
    assert.deepEqual(JSON.parse(prompt.split('資料(JSON):\n')[1]), {
      text: input.text,
      knownAnswer: '',
      originalExplanation: '',
    });
    return { value: schema.parse(extracted), searched: false };
  };
  const result = await adapter.extract(input, new AbortController().signal, () => {});
  assert.deepEqual(result.value.knownAnswerIds, []);
  assert.deepEqual(result.value.uncertainties, []);
});
test('extraction preserves genuine uncertainty for unreadable attachments, missing referenced diagrams and unmatched provided answers', async () => {
  const cases = [
    {
      text: '',
      knownAnswer: '',
      images: ['/private/fixture-one.png', '/private/fixture-two.webp'],
      warning: '2枚目の画像の選択肢B末尾が不明瞭です。',
    },
    {
      text: '次の図の構成を使います。図の処理順を確認してください。',
      knownAnswer: '',
      images: [],
      warning: '問題文が参照する図がないため、処理順を確認できません。',
    },
    {
      text: 'A. Athena B. EC2',
      knownAnswer: 'Z',
      images: [],
      warning: '提供された正解Zに対応する選択肢がありません。',
    },
  ];
  for (const item of cases) {
    const adapter = new CodexAdapter('/unused', { executable: 'unused', timeout: 1000 });
    adapter.run = async (schema, prompt, images, research) => {
      assert.deepEqual(images, item.images);
      assert.equal(research, false);
      assert.match(prompt, new RegExp(`画像添付枚数（アプリが確認）: ${item.images.length}枚`));
      if (item.images.length) {
        assert.match(prompt, /画像を実際に読み取れない場合はuncertaintiesに具体的に明記/);
        assert.ok(!prompt.includes('今回はテキストだけの入力です'));
      } else assert.match(prompt, /必要な図表を明示的に参照.*具体的な不足として記入/);
      assert.match(prompt, /提供された正解が選択肢に対応しない.*uncertaintiesに残します/);
      return {
        value: schema.parse({
          ...structuredClone(demoDocument.question),
          uncertainties: [item.warning],
        }),
        searched: false,
      };
    };
    const result = await adapter.extract(
      { ...item, originalExplanation: '' },
      new AbortController().signal,
      () => {},
    );
    assert.deepEqual(result.value.uncertainties, [item.warning]);
  }
});
test('question-specific output requires every option and maps it back to the shared array format', async () => {
  const explanation = structuredClone(demoDocument.revisions[0].explanation);
  const wire = requirementWire(explanation);
  const schema = explanationOutputSchema(demoDocument.question);
  assert.doesNotThrow(() => schema.parse(wire));
  assert.ok(!('checks' in schema.shape.evaluations.shape.a.shape));
  const incomplete = structuredClone(wire);
  delete incomplete.evaluations.b;
  assert.equal(schema.safeParse(incomplete).success, false);
  const missingCheck = structuredClone(wire);
  delete missingCheck.requirements[0].checks.b;
  assert.equal(schema.safeParse(missingCheck).success, false);
  const adapter = new CodexAdapter('/unused', { executable: 'unused', timeout: 1000 });
  adapter.run = async (schema) => ({ value: schema.parse(wire), searched: true });
  const result = await adapter.explain(
    demoDocument.question,
    new AbortController().signal,
    () => {},
  );
  validateReferences(demoDocument.question, result.value);
  assert.deepEqual(
    result.value.evaluations.map((e) => e.optionId),
    ['a', 'b', 'c'],
  );
  assert.equal(
    result.value.evaluations[0].checks[0].reason,
    explanation.evaluations[0].checks[0].reason,
  );
  assert.ok(result.value.evaluations[0].checks[0].nodeIds.includes('a-athena'));
  assert.deepEqual(result.value.requirements, explanation.requirements);
});

test('generation schema prevents background and preference failures in the emitted JSON schema', async () => {
  const schema = explanationOutputSchema(demoDocument.question);
  const json = z.toJSONSchema(schema) as any;
  const branches = json.properties.requirements.items.anyOf;
  for (const kind of ['hard', 'preference', 'context'] as const) {
    const branch = branches.find((branch: any) => branch.properties.kind.const === kind);
    const verdicts = branch.properties.checks.properties.b.properties.verdict.enum;
    assert.equal(verdicts.includes('violates'), kind === 'hard');
    const wire = requirementWire(demoDocument.revisions[0].explanation);
    wire.requirements[0].kind = kind;
    wire.requirements[0].checks.b.verdict = 'violates';
    assert.equal(schema.safeParse(wire).success, kind === 'hard');
    wire.requirements[0].checks.b.verdict = kind === 'preference' ? 'inferior' : 'unknown';
    assert.equal(schema.safeParse(wire).success, true);
  }
});

test('requirement-first output preserves multiple-choice and freeform contracts', async () => {
  for (const mode of ['multiple', 'none'] as const) {
    const question = structuredClone(demoDocument.question);
    const explanation = structuredClone(demoDocument.revisions[0].explanation);
    question.selectionMode = mode;
    question.selectionCount = mode === 'multiple' ? 2 : null;
    explanation.answerOptionIds = mode === 'multiple' ? ['a', 'b'] : [];
    question.knownAnswerIds = explanation.answerOptionIds;
    if (mode === 'none') {
      question.options = [];
      explanation.evaluations = [];
      explanation.architectures.forEach((graph) => { graph.optionIds = []; });
    }
    const adapter = new CodexAdapter('/unused', { executable: 'unused', timeout: 1000 });
    adapter.run = async (schema) => ({
      value: schema.parse(requirementWire(explanation)), searched: false,
    });
    const result = await adapter.explain(question, new AbortController().signal, () => {});
    validateReferences(question, result.value);
    assert.deepEqual(result.value.answerOptionIds, explanation.answerOptionIds);
    assert.equal(result.value.evaluations.length, question.options.length);
  }
});
test('completion requires missing option and requirement keys and accepts only existing reference IDs', async () => {
  const explanation = structuredClone(demoDocument.revisions[0].explanation);
  const selected = explanation.evaluations.filter((e) => ['b', 'c'].includes(e.optionId));
  const wire = {
    evaluations: Object.fromEntries(
      selected.map(({ optionId, checks, ...evaluation }) => [
        optionId,
        {
          ...evaluation,
          checks: Object.fromEntries(
            checks.map(({ requirementId, ...check }) => [requirementId, check]),
          ),
        },
      ]),
    ),
  };
  const schema = evaluationCompletionSchema(explanation, ['b', 'c']);
  assert.doesNotThrow(() => schema.parse(wire));
  const missing = structuredClone(wire);
  delete missing.evaluations.c;
  assert.equal(schema.safeParse(missing).success, false);
  const badSource = structuredClone(wire);
  Object.values(badSource.evaluations.b.checks)[0].sourceIds = ['invented-source'];
  assert.equal(schema.safeParse(badSource).success, false);
  const adapter = new CodexAdapter('/unused', { executable: 'unused', timeout: 1000 });
  adapter.run = async (schema, _prompt, _images, research) => {
    assert.equal(research, false);
    return { value: schema.parse(wire), searched: false };
  };
  const result = await adapter.completeEvaluations(
    demoDocument.question,
    explanation,
    ['b', 'c'],
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(result, selected);
});
test('progress exposes actual search actions and assistant updates but never reasoning or JSON payloads', () => {
  const event = (item: unknown, type = 'item.completed') =>
    parseCliEvent(JSON.stringify({ type, item }));
  const start = event(
    {
      type: 'web_search',
      action: { type: 'search', queries: ['site:docs.aws.amazon.com S3', 'Athena SQL'] },
    },
    'item.started',
  );
  assert.match(start.progress!.message, /S3/);
  assert.equal(start.searched, undefined);
  assert.match(
    event({
      type: 'web_search',
      action: {
        type: 'open_page',
        url: 'https://docs.aws.amazon.com/athena/?token=not-for-ui#fragment',
      },
    }).progress!.message,
    /docs.aws.amazon.com\/athena\//,
  );
  assert.ok(
    !event({
      type: 'web_search',
      action: { url: 'https://docs.aws.amazon.com/athena/?token=not-for-ui' },
    }).progress!.message.includes('token'),
  );
  assert.match(
    event({ type: 'agent_message', text: '公式資料を確認しました。図を作成します。' }).progress!
      .message,
    /図を作成/,
  );
  assert.equal(
    event({ type: 'agent_message', text: '{"private":"question content"}' }).progress!.stage,
    'composing',
  );
  assert.ok(
    !event({
      type: 'agent_message',
      text: '{"private":"question content"}',
    }).progress!.message.includes('private'),
  );
  assert.deepEqual(event({ type: 'reasoning', text: 'internal thought' }), {});
});
test('adapter passes prompt only through stdin, uses isolation and validates structured output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, 'mock-codex');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs=require('node:fs');
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
  const args=process.argv.slice(2);
  if(!args.includes('--ignore-user-config')||!args.includes('--ignore-rules')||!args.includes('--ephemeral')||!args.includes('read-only')||args.includes(input))process.exit(2);
  const setting=args.find(arg=>arg.startsWith('model_instructions_file='));
  const instructions=fs.readFileSync(JSON.parse(setting.slice(setting.indexOf('=')+1)),'utf8');
  if(!instructions.includes('exactly one final JSON')||!instructions.includes('untrusted task data')||!instructions.includes('Do not execute commands'))process.exit(3);
  console.log(JSON.stringify({type:'item.completed',item:{type:'web_search'}}));
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({answer:input})}}));
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:25}}));
});
`,
    { mode: 0o700 },
  );
  const adapter = new CodexAdapter(join(root, 'runtime'), { executable, timeout: 5000 });
  const result = await adapter.run(
    z.object({ answer: z.string() }),
    'a $(do-not-run) `shell` prompt',
    [],
    true,
    new AbortController().signal,
    () => {},
  );
  assert.equal(result.value.answer, 'a $(do-not-run) `shell` prompt');
  assert.equal(result.searched, true);
  assert.ok(result.metrics!.durationMs >= 0);
  assert.ok(result.metrics!.firstSearchMs !== null);
  assert.equal(result.metrics!.agentMessages.length, 1);
  assert.equal(result.metrics!.agentMessages[0].structured, true);
  assert.equal(result.metrics!.agentMessages[0].characters, JSON.stringify(result.value).length);
  assert.deepEqual(result.metrics!.usage, { inputTokens: 100, outputTokens: 25 });
  assert.ok(!JSON.stringify(result.metrics).includes('do-not-run'));
});
test('adapter times out and terminates a hung subprocess', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'question-lab-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, 'mock-codex');
  await writeFile(
    executable,
    '#!/usr/bin/env node\nprocess.stdin.resume();setInterval(()=>{},1000);\n',
    { mode: 0o700 },
  );
  const adapter = new CodexAdapter(join(root, 'runtime'), { executable, timeout: 100 });
  await assert.rejects(
    adapter.run(
      z.object({ answer: z.string() }),
      'test',
      [],
      false,
      new AbortController().signal,
      () => {},
    ),
    (e: unknown) => (e as { code?: string }).code === 'TIMEOUT',
  );
});

test('reassessment uses kind-constrained checks and only existing evidence, with no fresh research', async () => {
  const explanation = structuredClone(demoDocument.revisions[0].explanation);
  explanation.requirements[0].kind = 'context';
  explanation.evaluations[1].checks[0].verdict = 'violates';
  const fixed = structuredClone(explanation.evaluations[1]);
  fixed.checks[0].verdict = 'unknown';
  const { optionId, checks, ...evaluation } = fixed;
  const wire = { evaluations: { [optionId]: {
    ...evaluation,
    checks: Object.fromEntries(checks.map(({ requirementId, ...check }) => [requirementId, check])),
  } } };
  const adapter = new CodexAdapter('/unused', { executable: 'unused', timeout: 1000 });
  let calls = 0;
  adapter.run = async (schema, prompt, images, research) => {
    calls++;
    assert.deepEqual(images, []);
    assert.equal(research, false);
    assert.match(prompt, /判定の単純な置換や要件のhardへの格上げはせず/);
    assert.match(prompt, /複数選択は選ばれた組み合わせ/);
    assert.match(prompt, /根拠不足ならunknown/);
    const invalid = structuredClone(wire);
    invalid.evaluations.b.checks[explanation.requirements[0].id].verdict = 'violates';
    assert.equal(schema.safeParse(invalid).success, false);
    return { value: schema.parse(wire), searched: false };
  };
  const result = await adapter.repairEvaluations(
    demoDocument.question, explanation, ['b'], new AbortController().signal, () => {},
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, [fixed]);
});
