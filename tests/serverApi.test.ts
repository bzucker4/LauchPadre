import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';

function git(directory: string, ...args: string[]) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const sentMail: { to: string; text: string }[] = [];
const capturingMailer = {
  async send(mail: { to: string; subject: string; text: string }) {
    sentMail.push({ to: mail.to, text: mail.text });
  },
};

async function verifyLatestEmail(base: string, to: string) {
  const mail = [...sentMail].reverse().find((m) => m.to === to);
  const token = mail?.text.match(/\?verify=([a-f0-9]{64})/)?.[1];
  assert.ok(token, `verification email for ${to}`);
  const response = await fetch(`${base}/api/customer/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(response.status, 200);
}

test('HTTP server end-to-end: sovereignty, auth, CSRF, CRUD, quotas, password rotation, and checkpoints', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpadre-http-'));
  const dbPath = path.join(tempRoot, 'workspace.db');
  const gitRoot = path.join(tempRoot, 'git-root');
  fs.mkdirSync(gitRoot, { recursive: true });

  const { app, close } = await createApp({
    workspaceDbPath: dbPath,
    customerGitRoot: gitRoot,
    production: false,
    attachVite: false,
    mailer: capturingMailer,
    publicOrigin: 'https://app.example.test',
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check and robots.txt
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');

    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /User-agent: GPTBot/);

    // 2. Data Sovereignty: AI scraper blocked with 403 + X-Robots-Tag header
    const blocked = await fetch(`${base}/api/customer/me`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GPTBot/1.0)' },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(blocked.headers.get('x-frame-options'), 'DENY');

    // 3. Unknown API route returns JSON 404, malformed JSON returns 400
    const unknown = await fetch(`${base}/api/does-not-exist`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'Not found');

    const badJson = await fetch(`${base}/api/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).error, 'Invalid JSON body');

    // 4. Register & login customer A and customer B
    const regA = await fetch(`${base}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'correct-horse-battery', accepted_terms: true }),
    });
    assert.equal(regA.status, 201);
    const accountA = await regA.json();

    // Duplicate registration rejected with 409
    const dupA = await fetch(`${base}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ALICE@example.com', password: 'correct-horse-battery', accepted_terms: true }),
    });
    assert.equal(dupA.status, 409);

    // Unverified accounts cannot sign in until the emailed link is used
    const blockedLogin = await fetch(`${base}/api/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'correct-horse-battery', accepted_terms: true }),
    });
    assert.equal(blockedLogin.status, 403);
    assert.equal((await blockedLogin.json()).code, 'email_unverified');
    await verifyLatestEmail(base, 'alice@example.com');

    const loginA = await fetch(`${base}/api/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'correct-horse-battery', accepted_terms: true }),
    });
    assert.equal(loginA.status, 200);
    const setCookieA = loginA.headers.get('set-cookie') || '';
    assert.match(setCookieA, /HttpOnly/);
    assert.match(setCookieA, /SameSite=Lax/);
    const cookieA = setCookieA.split(';')[0];

    // Second session for Alice to verify password rotation revokes other sessions
    const loginA2 = await fetch(`${base}/api/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'correct-horse-battery', accepted_terms: true }),
    });
    const cookieA2 = (loginA2.headers.get('set-cookie') || '').split(';')[0];

    // 5. CSRF Origin & Sec-Fetch-Site protection on mutating customer routes
    const badOrigin = await fetch(`${base}/api/customer/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ name: 'csrf-repo' }),
    });
    assert.equal(badOrigin.status, 403);

    const crossSite = await fetch(`${base}/api/customer/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ name: 'csrf-repo' }),
    });
    assert.equal(crossSite.status, 403);

    // 6. Repository CRUD + Free tier 3-repo quota + Delete frees slot
    const createdRepoIds: string[] = [];
    for (const repoName of ['repo-one', 'repo-two', 'repo-three']) {
      const res = await fetch(`${base}/api/customer/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ name: repoName }),
      });
      assert.equal(res.status, 201);
      createdRepoIds.push((await res.json()).id);
    }

    const fourth = await fetch(`${base}/api/customer/repositories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'repo-four' }),
    });
    assert.equal(fourth.status, 402);

    // Rename repo 1
    const rename = await fetch(`${base}/api/customer/repositories/${createdRepoIds[0]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'repo-one-renamed' }),
    });
    assert.equal(rename.status, 200);
    assert.equal((await rename.json()).name, 'repo-one-renamed');

    // Delete repo 3 frees slot
    const delRepo = await fetch(`${base}/api/customer/repositories/${createdRepoIds[2]}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    assert.equal(delRepo.status, 200);

    const replacement = await fetch(`${base}/api/customer/repositories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'repo-replacement' }),
    });
    assert.equal(replacement.status, 201);

    // 7. Task CRUD + cross-customer isolation
    const addTask = await fetch(`${base}/api/customer/repositories/${createdRepoIds[0]}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ title: 'Ship v1.0' }),
    });
    assert.equal(addTask.status, 201);
    const task = await addTask.json();

    const patchTask = await fetch(`${base}/api/customer/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ status: 'done', title: 'Ship v1.0 cleanly' }),
    });
    assert.equal(patchTask.status, 200);
    assert.deepEqual(await patchTask.json(), { id: task.id, title: 'Ship v1.0 cleanly', status: 'done' });

    // Register & login customer B — must not see Alice's repo or delete Alice's task
    await fetch(`${base}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'bob-password-1234', accepted_terms: true }),
    });
    await verifyLatestEmail(base, 'bob@example.com');
    const loginB = await fetch(`${base}/api/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'bob-password-1234', accepted_terms: true }),
    });
    const cookieB = (loginB.headers.get('set-cookie') || '').split(';')[0];

    const bobDeleteAliceTask = await fetch(`${base}/api/customer/tasks/${task.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieB },
    });
    assert.equal(bobDeleteAliceTask.status, 404);

    const aliceDeleteTask = await fetch(`${base}/api/customer/tasks/${task.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    assert.equal(aliceDeleteTask.status, 200);

    // 8. Provision real Git repo for Alice and test HTTP bind + checkpoint + restore
    const aliceRepoDir = path.join(gitRoot, accountA.id, 'service');
    fs.mkdirSync(aliceRepoDir, { recursive: true });
    git(aliceRepoDir, 'init');
    git(aliceRepoDir, 'config', 'user.name', 'Alice');
    git(aliceRepoDir, 'config', 'user.email', 'alice@example.com');
    fs.writeFileSync(path.join(aliceRepoDir, 'app.txt'), 'v1\n');
    git(aliceRepoDir, 'add', '.');
    git(aliceRepoDir, 'commit', '-m', 'v1');

    const bindRes = await fetch(`${base}/api/customer/repositories/${createdRepoIds[0]}/git`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ relative_path: 'service/' }),
    });
    assert.equal(bindRes.status, 200);
    const bound = await bindRes.json();
    assert.equal(bound.relative_path, 'service');

    const snapRes = await fetch(`${base}/api/customer/repositories/${createdRepoIds[0]}/checkpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'release_1' }),
    });
    assert.equal(snapRes.status, 201);
    const snap = await snapRes.json();

    fs.writeFileSync(path.join(aliceRepoDir, 'app.txt'), 'v2\n');
    git(aliceRepoDir, 'commit', '-am', 'v2');
    const headV2 = git(aliceRepoDir, 'rev-parse', 'HEAD');

    const restoreRes = await fetch(`${base}/api/customer/repositories/${createdRepoIds[0]}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ tag: snap.tag, expected_head: headV2, expected_target: snap.head }),
    });
    assert.equal(restoreRes.status, 200);
    const restored = await restoreRes.json();
    assert.match(restored.recoveryRef, /^refs\/launchpadre\/recovery\//);
    assert.equal(fs.readFileSync(path.join(aliceRepoDir, 'app.txt'), 'utf8'), 'v1\n');

    // 9. Password change keeps current session and revokes other sessions
    const pwRes = await fetch(`${base}/api/customer/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        current_password: 'correct-horse-battery',
        new_password: 'brand-new-strong-password',
      }),
    });
    assert.equal(pwRes.status, 200);

    assert.equal((await fetch(`${base}/api/customer/me`, { headers: { Cookie: cookieA } })).status, 200);
    assert.equal((await fetch(`${base}/api/customer/me`, { headers: { Cookie: cookieA2 } })).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
