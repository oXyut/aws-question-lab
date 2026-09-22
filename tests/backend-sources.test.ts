import test from 'node:test';
import assert from 'node:assert/strict';
import { isOfficialUrl, verifySources, visibleText } from '../server/sources.ts';

const source = {
  id: 's1',
  title: 'S3',
  url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
  excerpt: 'Amazon S3 is an object storage service.',
};
test('only exact AWS HTTPS hosts are accepted', () => {
  for (const url of ['https://aws.amazon.com/s3/', source.url])
    assert.equal(isOfficialUrl(url), true);
  for (const url of [
    'http://docs.aws.amazon.com/a',
    'https://docs.aws.amazon.com.attacker.test/a',
    'https://aws.amazon.com:8080/',
    'https://user:pass@aws.amazon.com/',
    'file:///etc/passwd',
    'https://127.0.0.1/',
    'https://s3.amazonaws.com/a',
  ])
    assert.equal(isOfficialUrl(url), false);
});
test('official source requires fresh search AND matching visible excerpt', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(
      `<html><script>secret citation</script><p>Amazon S3 is an <b>object</b> storage service.</p></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  }) as typeof fetch;
  const withoutSearch = await verifySources([source], false, undefined, fetcher);
  assert.equal(withoutSearch[0].status, 'unverified');
  assert.equal(calls, 0);
  const verified = await verifySources([source], true, undefined, fetcher);
  assert.equal(verified[0].status, 'verified');
  assert.ok(verified[0].checkedAt);
  const mismatch = await verifySources(
    [{ ...source, excerpt: 'A fabricated sentence that is not on the page.' }],
    true,
    undefined,
    fetcher,
  );
  assert.equal(mismatch[0].status, 'unverified');
  assert.equal(visibleText('<style>hidden words</style><p>a &amp; b</p>'), 'a & b');
});
test('redirects never reach a non-official host', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  }) as typeof fetch;
  assert.equal((await verifySources([source], true, undefined, fetcher))[0].status, 'unverified');
  assert.equal(calls, 1);
});
test('HTTP errors and unsupported content do not verify a source', async () => {
  for (const response of [
    new Response('', { status: 403 }),
    new Response('binary', { headers: { 'content-type': 'application/pdf' } }),
  ]) {
    assert.equal(
      (await verifySources([source], true, undefined, (async () => response) as typeof fetch))[0]
        .status,
      'unverified',
    );
  }
});
