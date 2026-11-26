import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.ts';
import { CustomerAuth } from '../src/customerAuth.ts';
import { CustomerCheckpoints } from '../src/customerCheckpoints.ts';

const json = { 'Content-Type': 'application/json' };

test('export contains only the customer\'s data; deletion cancels billing, removes drafts, files and rows', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_RETURN_ORIGIN: 'http://127.0.0.1:3000',
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpadre-data-'));
  const gitRoot = path.join(root, 'git');
  fs.mkdirSync(gitRoot);
  const mails: { to: string; text: string; subject: string }[] = [];
  const stripeCalls: string[] = [];
  const zenodoCalls: string[] = [];
  let stripeStatus = 500;
  const { app, database, close } = await createApp({
    workspaceDbPath: path.join(root, 'w.db'),
    customerGitRoot: gitRoot,
    production: false,
    attachVite: false,
    mailer: { async send(m) { mails.push(m); } },
    publicOrigin: 'https://app.example.test',
    zenodoToken: 'zeno_token',
    zenodoBaseUrl: 'https://sandbox.zenodo.org',
    billingRequest: async (input, init) => {
      stripeCalls.push(`${init?.method} ${new URL(String(input)).pathname}`);
      return Response.json({}, { status: stripeStatus });
    },
    zenodoRequest: async (input, init) => {
      zenodoCalls.push(`${init?.method} ${new URL(String(input)).pathname}`);
      return new Response(null, { status: String(input).endsWith('/222') ? 404 : 201 });
    },
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (p: string, body: unknown, cookie = '') =>
    fetch(`${base}${p}`, { method: 'POST', headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });

  async function signUp(email: string, password: string) {
    assert.equal((await post('/api/customer/register', { email, password, accepted_terms: true })).status, 201);
    const mail = [...mails].reverse().find((m) => m.to === email)!;
    const token = mail.text.match(/\?verify=([a-f0-9]{64})/)![1];
    assert.equal((await post('/api/customer/verify-email', { token })).status, 200);
    const login = await post('/api/customer/login', { email, password });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const me = await (await fetch(`${base}/api/customer/me`, { headers: { Cookie: cookie } })).json();
    return { cookie, id: me.id as string };
  }

  try {
    const alice = await signUp('alice-data@example.com', 'alice-password-123');
    const bob = await signUp('bob-data@example.com', 'bob-password-12345');

    for (const [who, name] of [[alice, 'alice-repo'], [bob, 'bob-repo']] as const) {
      const repo = await (await post('/api/customer/repositories', { name }, who.cookie)).json();
      assert.ok(repo.id);
      await post(`/api/customer/repositories/${repo.id}/tasks`, { title: `${name} task` }, who.cookie);
      const dir = path.join(gitRoot, who.id, name);
      fs.mkdirSync(dir, { recursive: true });
      execFileSync('git', ['-C', dir, 'init', '-q']);
      fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
      (who as any).repo = repo.id;
    }
    database.prepare('INSERT INTO stripe_customer_accounts VALUES (?,?)').run(alice.id, 'cus_alice');
    for (const [id, dep] of [['a1', '111'], ['a2', '222']]) {
      database
        .prepare(
          `INSERT INTO customer_zenodo_archives (id,repository_id,customer_id,commit_sha,deposition_id,status,sandbox,title,description,creator_name,creator_affiliation,archive_filename,archive_size_bytes,created_at)
           VALUES (?,?,?,?,?,'draft',1,'t','d','n','a','f.zip',1,?)`
        )
        .run(id, (alice as any).repo, alice.id, 'abc', dep, new Date().toISOString());
    }

    // --- export
    assert.equal((await fetch(`${base}/api/customer/export`)).status, 401);
    const exp = await fetch(`${base}/api/customer/export`, { headers: { Cookie: alice.cookie } });
    assert.equal(exp.status, 200);
    assert.match(exp.headers.get('content-disposition') || '', /^attachment; filename="launchpadre-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await exp.text();
    const data = JSON.parse(text);
    assert.equal(data.account.email, 'alice-data@example.com');
    assert.equal(data.repositories.length, 1);
    assert.equal(data.repositories[0].name, 'alice-repo');
    assert.equal(data.repositories[0].tasks[0].title, 'alice-repo task');
    assert.equal(data.zenodo_archives.length, 2);
    assert.equal(data.billing.stripe_customer_id, 'cus_alice');
    assert.ok(data.account.terms_accepted_at);
    assert.ok(!/password|token_hash|bob/i.test(text.replace(/"not_included"[\s\S]*$/, '')), 'no credentials or other customers');

    // --- deletion guards
    const del = (body: unknown, cookie = alice.cookie) => post('/api/customer/delete-account', body, cookie);
    assert.equal((await post('/api/customer/delete-account', { password: 'x', confirm: 'DELETE' })).status, 401);
    assert.equal((await del({ password: 'alice-password-123' })).status, 400, 'confirmation phrase required');
    assert.equal((await del({ password: 'wrong-password-123', confirm: 'DELETE' })).status, 401);
    assert.equal(stripeCalls.length, 0);

    // Billing failure aborts before the account or files are touched.
    assert.equal((await del({ password: 'alice-password-123', confirm: 'DELETE' })).status, 502);
    assert.deepEqual(stripeCalls, ['DELETE /v1/customers/cus_alice']);
    assert.ok(fs.existsSync(path.join(gitRoot, alice.id)));
    assert.equal((await fetch(`${base}/api/customer/me`, { headers: { Cookie: alice.cookie } })).status, 200);

    // --- successful deletion (retry is idempotent: Zenodo drafts were already attempted)
    stripeStatus = 200;
    const ok = await del({ password: 'alice-password-123', confirm: 'DELETE' });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie') || '', /lp_customer=;.*Max-Age=0/);
    assert.ok(zenodoCalls.includes('DELETE /api/deposit/depositions/111'));
    assert.ok(zenodoCalls.includes('DELETE /api/deposit/depositions/222'));
    assert.equal(fs.existsSync(path.join(gitRoot, alice.id)), false, 'tenant Git directory removed');
    assert.ok(fs.existsSync(path.join(gitRoot, bob.id, 'bob-repo', 'f.txt')), 'other tenant untouched');
    assert.equal((await fetch(`${base}/api/customer/me`, { headers: { Cookie: alice.cookie } })).status, 401);
    assert.equal((await post('/api/customer/login', { email: 'alice-data@example.com', password: 'alice-password-123' })).status, 401);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(mails.some((m) => m.to === 'alice-data@example.com' && /deleted/i.test(m.subject)));

    // No row anywhere still references the deleted customer; the other customer is intact.
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    for (const { name } of tables) {
      const cols = (database.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
      for (const col of ['id', 'customer_id', 'account_id'].filter((c) => cols.includes(c) && name !== 'workspace')) {
        if (col === 'id' && name !== 'customer_accounts') continue;
        const left = database.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE ${col}=?`).get(alice.id) as { n: number };
        assert.equal(left.n, 0, `${name}.${col} still references the deleted account`);
      }
    }
    const bobRepos = database.prepare('SELECT COUNT(*) AS n FROM customer_repositories WHERE customer_id=?').get(bob.id) as { n: number };
    assert.equal(bobRepos.n, 1);

    // The email can be registered again as a brand-new, empty account.
    const again = await signUp('alice-data@example.com', 'alice-password-123');
    assert.notEqual(again.id, alice.id);
    const fresh = await (await fetch(`${base}/api/customer/export`, { headers: { Cookie: again.cookie } })).json();
    assert.equal(fresh.repositories.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
    await close();
    process.env = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tenant directory removal never follows symlinks or leaves the Git root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpadre-tenant-'));
  const gitRoot = path.join(root, 'git');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(gitRoot);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const auth = new CustomerAuth(db);
  db.exec(`CREATE TABLE customer_repositories (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const checkpoints = new CustomerCheckpoints(db, gitRoot);
  const user = auth.register('s@example.com', 'symlink-password-1');
  try {
    assert.equal(checkpoints.removeTenantData(user.id), false, 'missing directory is a no-op');
    assert.throws(() => checkpoints.removeTenantData('../outside'), /Invalid customer/);

    fs.symlinkSync(outside, path.join(gitRoot, user.id));
    assert.throws(() => checkpoints.removeTenantData(user.id), /not a regular directory/);
    assert.ok(fs.existsSync(path.join(outside, 'keep.txt')), 'symlink target untouched');
    fs.unlinkSync(path.join(gitRoot, user.id));

    // A symlink inside the tenant directory is removed, not followed.
    fs.mkdirSync(path.join(gitRoot, user.id));
    fs.symlinkSync(outside, path.join(gitRoot, user.id, 'link'));
    assert.equal(checkpoints.removeTenantData(user.id), true);
    assert.ok(fs.existsSync(path.join(outside, 'keep.txt')), 'inner symlink target untouched');
    assert.equal(fs.existsSync(path.join(gitRoot, user.id)), false);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
