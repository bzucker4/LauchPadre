import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const liveMode = process.argv.includes('--live');
const localOnly = process.argv.includes('--local');
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const directory = await mkdtemp(path.join(tmpdir(), 'launchpadre-smoke-'));
const project = path.join(directory, 'project');
await mkdir(project);
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' }).trim();
git('init', '-q'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.com');
await writeFile(path.join(project, 'file.txt'), 'baseline'); git('add', '.'); git('commit', '-qm', 'baseline');
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  env: { ...process.env, NODE_ENV: 'production', LOCAL_ONLY: localOnly ? 'true' : 'false', LAUNCHPADRE_DEMO: liveMode ? 'false' : 'true', ADMIN_EMAIL: 'owner@example.com', PORT: String(port), ADMIN_PASSWORD: 'smoke-test-password-12345', STATE_DB_PATH: path.join(directory, 'state.db'), GIT_REPOSITORIES_ROOT: directory, STRIPE_WEBHOOK_SECRET: 'test-webhook-secret', WEBHOOK_SECRET: 'test-git-secret' },
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
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok', mode: liveMode ? 'live' : 'demo' });
  assert.equal((await fetch(`${base}/api/v1/repositories`)).status, 401);
  const rejected = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(rejected.status, 401);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'smoke-test-password-12345' }) });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal(login.headers.get('set-cookie').includes('Secure'), !localOnly);
  assert.ok(login.headers.get('set-cookie').includes('SameSite=Strict'));
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const signedFetch = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, cookie } });
  const repos = await (await signedFetch(`${base}/api/v1/repositories`)).json();
  if (liveMode) { assert.equal(repos.length, 0); } else {
    assert.ok(repos.length > 0);
    const response = await signedFetch(`${base}/api/v1/repositories/${repos[0].forgejo_repo_id}/snapshots`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray((await response.json()).snapshots));
  }
  const missing = await signedFetch(`${base}/api/v1/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'API endpoint not found');
  assert.equal((await fetch(base)).status, 200);
  const crossSite = await signedFetch(`${base}/api/v1/state/reset`, { method: 'POST', headers: { origin: 'https://untrusted.example' } });
  assert.equal(crossSite.status, 403);
  const badSignature = await signedFetch(`${base}/api/v1/webhooks/git-core`, { method: 'POST', headers: { 'X-Gitea-Signature': 'short' }, body: '{}' });
  assert.equal(badSignature.status, 401);
  const post = (route, body) => signedFetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/v1/repositories', { local_path: '../outside' })).status, 400);
  const registration = await post('/api/v1/repositories', { local_path: 'project' });
  assert.equal(registration.status, 201);
  const live = await registration.json();
  assert.equal(live.mode, 'live');
  const taskResponse = await post(`/api/v1/repositories/${live.id}/tasks`, { title: 'Test real workspace task' });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json();
  const changeTask = await signedFetch(`${base}/api/v1/tasks/${task.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
  assert.equal((await changeTask.json()).status, 'done');
  const invalidTask = await signedFetch(`${base}/api/v1/tasks/${task.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'invalid' }) });
  assert.equal(invalidTask.status, 400);
  const gitEvent = JSON.stringify({ repository: { id: live.id, full_name: live.full_name }, commits: [{ id: git('rev-parse', 'HEAD'), message: 'todo: Verify ingestion', author: { name: 'Test' } }] });
  const gitSignature = crypto.createHmac('sha256', 'test-git-secret').update(gitEvent).digest('hex');
  const ingest = () => fetch(`${base}/api/v1/webhooks/git-core`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gitea-Signature': gitSignature }, body: gitEvent });
  assert.equal((await (await ingest()).json()).processed_commits, 1);
  assert.equal((await (await ingest()).json()).processed_commits, 0);
  const snapshot = await post('/api/v1/panic/snapshots', { repo_id: live.id, snapshot_name: 'smoke' });
  assert.equal(snapshot.status, 201);
  assert.equal((await snapshot.json()).target_commit_sha, git('rev-parse', 'HEAD'));
  assert.equal((await post('/api/v1/panic/rollback', { repo_id: live.id, snapshot_name: 'smoke' })).status, 400);
  assert.equal((await post('/api/v1/state/reset', {})).status, 409);
  const badStripe = await signedFetch(`${base}/api/v1/billing/webhooks/stripe`, { method: 'POST', body: '{}' });
  assert.equal(badStripe.status, 401);
  const event = JSON.stringify({ id: 'evt_smoke', type: 'test.event', data: { object: {} } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', 'test-webhook-secret').update(`${timestamp}.${event}`).digest('hex');
  const sendWebhook = () => fetch(`${base}/api/v1/billing/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body: event });
  assert.equal((await sendWebhook()).status, 200);
  assert.equal((await (await sendWebhook()).json()).status, 'duplicate');
  await signedFetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal((await signedFetch(`${base}/api/v1/repositories`)).status, 401);
  console.log(`Authenticated ${liveMode ? 'live' : 'demo'} smoke checks passed`);
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  await rm(directory, { recursive: true, force: true });
}
