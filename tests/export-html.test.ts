import test from 'node:test';
import assert from 'node:assert/strict';
import { demoDocument } from '../shared/demo.js';
import { renderExport } from '../server/export.js';

test('HTML exports the selected revision with inline assets and no external runtime resources', async () => {
  const document = structuredClone(demoDocument);
  const followup = structuredClone(document.revisions[0]!);
  followup.id = 'sample-followup';
  followup.parentRevisionId = document.revisions[0]!.id;
  followup.question.title = '追加質問の別の版';
  document.revisions.push(followup);
  document.revisions[0]!.question.title = '</title><script>alert("title")</script>';
  document.revisions[0]!.explanation.shortAnswer = '</script><img src=x onerror="alert(1)">';

  const html = await renderExport(document, 'sample-original');
  assert.match(html, /<!doctype html>/);
  assert.match(html, /lang="ja"/);
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;/);
  assert.doesNotMatch(
    html,
    /<script[^>]+src\s*=|<link[^>]+href\s*=|<img[^>]+src=["'](?:https?:|\/aws-icons)/i,
  );
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  const serialized = html.match(/window\.__QUESTION_LAB_EXPORT__=([^]*?);<\/script>/)?.[1];
  assert.ok(serialized);
  const payload = JSON.parse(serialized) as {
    revision: { id: string; explanation: { shortAnswer: string } };
    icons: Record<string, string>;
  };
  assert.equal(payload.revision.id, 'sample-original');
  assert.equal(
    payload.revision.explanation.shortAnswer,
    document.revisions[0]!.explanation.shortAnswer,
  );
  assert.ok(payload.icons.athena?.startsWith('data:image/svg+xml;base64,'));
  // React's trusted bundle can contain the literal string "<script>"; only the
  // two HTML parser closing tags should remain unescaped.
  assert.equal(html.match(/<\/script>/g)?.length, 2);

  const latest = await renderExport(document);
  assert.match(latest, /<title>追加質問の別の版/);
  await assert.rejects(renderExport(document, 'nonexistent'), /版が見つかりません/);
});
