import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const directory = await mkdtemp(path.join(tmpdir(), 'launchpadre-smoke-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  env: { ...process.env, NODE_ENV: 'production', LAUNCHPADRE_DEMO: 'true', PORT: String(port), ADMIN_PASSWORD: 'smoke-test-password-12345', STATE_DB_PATH: path.join(directory, 'state.db') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { ready = (await fetch(`${base}/healthz`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Server did not become ready: ${logs}`);
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok', mode: 'demo' });
  assert.equal((await fetch(`${base}/api/v1/repositories`)).status, 401);
  const rejected = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(rejected.status, 401);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'smoke-test-password-12345' }) });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(login.headers.get('set-cookie').includes('Secure'));
  assert.ok(login.headers.get('set-cookie').includes('SameSite=Strict'));
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const signedFetch = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, cookie } });
  const repos = await (await signedFetch(`${base}/api/v1/repositories`)).json();
  assert.ok(repos.length > 0);
  const response = await signedFetch(`${base}/api/v1/repositories/${repos[0].forgejo_repo_id}/snapshots`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).snapshots));
  const missing = await signedFetch(`${base}/api/v1/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'API endpoint not found');
  assert.equal((await fetch(base)).status, 200);
  const crossSite = await signedFetch(`${base}/api/v1/state/reset`, { method: 'POST', headers: { origin: 'https://untrusted.example' } });
  assert.equal(crossSite.status, 403);
  const badSignature = await signedFetch(`${base}/api/v1/webhooks/git-core`, { method: 'POST', headers: { 'X-Gitea-Signature': 'short' }, body: '{}' });
  assert.equal(badSignature.status, 401);
  const badStripe = await signedFetch(`${base}/api/v1/billing/webhooks/stripe`, { method: 'POST', body: '{}' });
  assert.equal(badStripe.status, 401);
  await signedFetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal((await signedFetch(`${base}/api/v1/repositories`)).status, 401);
  console.log('Authenticated demo smoke checks passed');
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  await rm(directory, { recursive: true, force: true });
}
