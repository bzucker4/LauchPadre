import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZenodoClient } from '../src/zenodoClient.ts';

test('Zenodo drafts do not publish implicitly and tokens stay on the configured host', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const request = (async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 123, links: { bucket: 'https://sandbox.zenodo.org/api/files/bucket' } }), { status: 201 });
  }) as typeof fetch;
  const client = new ZenodoClient('https://sandbox.zenodo.org', 'test-token', request);
  const draft = await client.create({ title: 'Test', upload_type: 'software' });
  await client.upload(draft, 'archive.zip', Buffer.from('archive'));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !call.url.includes('/publish')));
  assert.equal(calls[1].options.redirect, 'error');
  await assert.rejects(client.upload({ links: { bucket: 'https://evil.example/api/files/bucket' } }, 'archive.zip', Buffer.from('archive')));
  assert.equal(calls.length, 2);
  await client.publish('123');
  assert.equal(calls[2].url, 'https://sandbox.zenodo.org/api/deposit/depositions/123/actions/publish');
});
