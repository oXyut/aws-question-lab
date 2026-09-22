import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { demoDocument } from '../shared/demo.js';
import { iconFileFor, serviceIcons } from '../shared/icons.js';
import { ExplanationDocumentSchema, quoteSpan, validateReferences } from '../shared/schema.js';
import { escapeHtml, serializeForScript } from '../server/export.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('the synthetic fixture has exact quotes and valid cross-graph references', () => {
  ExplanationDocumentSchema.parse(demoDocument);
  for (const revision of demoDocument.revisions) {
    validateReferences(revision.question, revision.explanation);
    for (const requirement of revision.explanation.requirements) {
      const span = quoteSpan(revision.question.text, requirement);
      assert.ok(span);
      assert.equal(revision.question.text.slice(span.start, span.end), requirement.quote);
    }
  }
  assert.match(demoDocument.question.originalExplanation, /架空/);
});

test('official service aliases normalize without guessing unavailable artwork', () => {
  for (const name of [
    's3',
    'AWS S3',
    'Amazon S3',
    'amazon-simple-storage-service',
    'Amazon_Simple_Storage_Service',
  ]) {
    assert.equal(iconFileFor(name), 's3.svg');
  }
  assert.equal(iconFileFor('AWS Glue Data Catalog'), 'catalog.svg');
  assert.equal(iconFileFor('Amazon Redshift Spectrum'), 'redshift.svg');
  assert.equal(iconFileFor('Amazon Kinesis Data Streams'), 'kinesis.svg');
  assert.equal(iconFileFor('Amazon EC2'), 'ec2.svg');
  assert.equal(iconFileFor('AWS::S3::Bucket'), 's3.svg');
  assert.equal(iconFileFor(null), null);
  assert.equal(iconFileFor('a new service'), null);
  assert.equal(iconFileFor('__proto__'), null);
  assert.equal(iconFileFor('../../private-file'), null);
});

test('every referenced AWS SVG matches its official archive provenance digest', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'public/aws-icons/manifest.json'), 'utf8'),
  ) as { file: string; source: string; sha256: string }[];
  assert.equal(new Set(manifest.map((item) => item.file)).size, manifest.length);
  for (const filename of new Set(Object.values(serviceIcons))) {
    const item = manifest.find((entry) => entry.file === filename);
    assert.ok(item, filename);
    const bytes = await readFile(path.join(root, 'public/aws-icons', filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, filename);
    assert.match(item.source, /Icons_07312026/);
    assert.doesNotMatch(
      bytes.toString(),
      /<script|<foreignObject|\son\w+\s*=|(?:href|src)=["']https?:/i,
    );
  }
});

test('embedded JSON cannot break out of script tags and preserves original content', () => {
  const input = {
    title: '</script><script>alert("x")</script>',
    body: '\u2028 paragraph\u2029 < & "',
  };
  const serialized = serializeForScript(input);
  assert.doesNotMatch(serialized, /</);
  assert.doesNotMatch(serialized, /[\u2028\u2029]/);
  assert.deepEqual(JSON.parse(serialized), input);
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)"> & \'text\''),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;text&#39;',
  );
});
