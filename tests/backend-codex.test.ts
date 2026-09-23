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
import { validateReferences } from '../shared/schema.ts';

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
  const wire = {
    ...explanation,
    evaluations: Object.fromEntries(
      explanation.evaluations.map(({ optionId, checks, ...evaluation }) => [
        optionId,
        {
          ...evaluation,
          checks: checks.map(({ nodeIds: _nodes, edgeIds: _edges, ...check }) => check),
        },
      ]),
    ),
  };
  const schema = explanationOutputSchema(demoDocument.question);
  assert.doesNotThrow(() => schema.parse(wire));
  assert.ok(!('nodeIds' in schema.shape.evaluations.shape.a.shape.checks.element.shape));
  assert.ok(!('edgeIds' in schema.shape.evaluations.shape.a.shape.checks.element.shape));
  const incomplete = structuredClone(wire);
  delete incomplete.evaluations.b;
  assert.equal(schema.safeParse(incomplete).success, false);
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
