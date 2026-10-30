import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  env: { ...process.env, NODE_ENV: 'production', LAUNCHPADRE_DEMO: 'true', PORT: String(port) },
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
  const repos = await (await fetch(`${base}/api/v1/repositories`)).json();
  assert.ok(repos.length > 0);
  const response = await fetch(`${base}/api/v1/repositories/${repos[0].forgejo_repo_id}/snapshots`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).snapshots));
  const missing = await fetch(`${base}/api/v1/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'API endpoint not found');
  assert.equal((await fetch(base)).status, 200);
  console.log('Demo smoke checks passed');
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
}
