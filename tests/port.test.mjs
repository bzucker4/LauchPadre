import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { portIsBusy } from '../scripts/port-check.mjs';

test('the launcher detects an existing listener before rebuilding its frontend', async () => {
  const server = net.createServer(); server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try { assert.equal(await portIsBusy(port), true); }
  finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await portIsBusy(port), false);
});

test('doctor diagnoses an older server without attempting a password login', async () => {
  let loginAttempts = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/healthz') { res.end(JSON.stringify({ status: 'ok', mode: 'live' })); return; }
    if (req.url === '/api/auth/login') loginAttempts++;
    res.statusCode = 404; res.end(JSON.stringify({ error: 'API endpoint not found' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const child = spawn(process.execPath, ['scripts/doctor.mjs'], { env: { ...process.env, PORT: String(server.address().port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1); assert.match(output, /out of date or incompatible/); assert.equal(loginAttempts, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('local startup stops before the build when another process owns the port', async () => {
  const server = net.createServer(); server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const child = spawn(process.execPath, ['scripts/start-local.mjs'], {
      env: { ...process.env, PORT: String(server.address().port), ADMIN_EMAIL: 'test@example.com', ADMIN_PASSWORD: 'test-local-password-12345' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output, /already in use/);
    assert.doesNotMatch(output, /building client environment/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
