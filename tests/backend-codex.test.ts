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
} from '../server/codex.ts';
import { demoDocument } from '../shared/demo.ts';

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
test('question-specific output requires every option and maps it back to the shared array format', async () => {
  const explanation = structuredClone(demoDocument.revisions[0].explanation);
  const wire = {
    ...explanation,
    evaluations: Object.fromEntries(
      explanation.evaluations.map(({ optionId, ...evaluation }) => [optionId, evaluation]),
    ),
  };
  const schema = explanationOutputSchema(demoDocument.question);
  assert.doesNotThrow(() => schema.parse(wire));
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
  assert.deepEqual(result.value.evaluations, explanation.evaluations);
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
    `#!/usr/bin/env node\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const args=process.argv.slice(2);if(!args.includes('--ignore-user-config')||!args.includes('--ignore-rules')||!args.includes('--ephemeral')||!args.includes('read-only')||args.includes(input))process.exit(2);console.error('warning: missing base_instructions');console.log(JSON.stringify({type:'item.completed',item:{type:'web_search'}}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({answer:input})}}));});\n`,
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
