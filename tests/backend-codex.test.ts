import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { CodexAdapter, parseCliEvent, safeCliError } from '../server/codex.ts';

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
