import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { CustomerAuth } from '../src/customerAuth.ts';
import { createApp } from '../server.ts';

test('terms versions: accounts accept the current version, a new version re-prompts, legacy rows migrate sensibly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpadre-terms-'));
  const file = path.join(dir, 't.db');
  try {
    // Database created before versioning existed: one account that accepted, one that never did.
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE customer_accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free', email_verified_at TEXT, terms_accepted_at TEXT);
      CREATE TABLE customer_sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    const ins = old.prepare('INSERT INTO customer_accounts (id,email,password_hash,created_at,terms_accepted_at) VALUES (?,?,?,?,?)');
    ins.run('accepted', 'a@example.com', 'x:y', '2026-01-01', '2026-01-02T00:00:00Z');
    ins.run('never', 'n@example.com', 'x:y', '2026-01-01', null);
    old.close();

    let db = new DatabaseSync(file);
    let auth = new CustomerAuth(db, '2026-12-01');
    const login = (email: string, password: string) => {
      const result = auth.login(email, password);
      assert.ok(result && 'token' in result);
      return result.token;
    };
    const fresh = auth.register('fresh@example.com', 'fresh-password-1', new Date().toISOString());
    const unaccepted = auth.register('unaccepted@example.com', 'unaccepted-pass-1');
    for (const id of [fresh.id, unaccepted.id]) {
      db.prepare('UPDATE customer_accounts SET email_verified_at=? WHERE id=?').run(new Date().toISOString(), id);
    }
    assert.equal(auth.session(login('fresh@example.com', 'fresh-password-1'))!.terms_current, true);
    const staleToken = login('unaccepted@example.com', 'unaccepted-pass-1');
    assert.equal(auth.session(staleToken)!.terms_current, false);
    auth.acceptTerms(unaccepted.id);
    assert.equal(auth.session(staleToken)!.terms_current, true);

    // Migration: the legacy row that accepted is stamped with the version in force; the one that never did stays unaccepted.
    const rows = db.prepare('SELECT id,terms_accepted_version AS v FROM customer_accounts WHERE id IN (?,?) ORDER BY id').all('accepted', 'never') as { id: string; v: string | null }[];
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ id: 'accepted', v: '2026-12-01' }, { id: 'never', v: null }]);

    // Publishing a new version re-prompts everyone, including people who had accepted the old one.
    db.close();
    db = new DatabaseSync(file);
    auth = new CustomerAuth(db, '2027-03-01');
    assert.equal(auth.session(staleToken)!.terms_current, false);
    auth.acceptTerms(unaccepted.id);
    assert.equal(auth.session(staleToken)!.terms_current, true);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP: unaccepted accounts are blocked everywhere except accept, export and delete', async () => {
  const mails: { to: string; text: string }[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpadre-gate-'));
  const options = (effective: string) => ({
    workspaceDbPath: path.join(dir, 'w.db'),
    production: false,
    attachVite: false,
    mailer: { async send(m: { to: string; text: string }) { mails.push(m); } },
    publicOrigin: 'https://app.example.test',
    legalValues: { EFFECTIVE_DATE: effective },
  });
  const listen = async (effective: string) => {
    const created = await createApp(options(effective));
    const server = await new Promise<ReturnType<typeof created.app.listen>>((r) => {
      const s = created.app.listen(0, '127.0.0.1', () => r(s));
    });
    return { ...created, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };
  const call = (base: string, method: string, p: string, cookie: string, body?: unknown) =>
    fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let v1 = await listen('2026-12-01');
  let cookie = '';
  try {
    const post = (p: string, body: unknown) =>
      fetch(`${v1.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/api/customer/register', { email: 'gate@example.com', password: 'gate-password-123', accepted_terms: true });
    await post('/api/customer/verify-email', { token: mails[0].text.match(/\?verify=([a-f0-9]{64})/)![1] });
    const login = await post('/api/customer/login', { email: 'gate@example.com', password: 'gate-password-123' });
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    assert.equal((await (await call(v1.base, 'GET', '/api/customer/me', cookie)).json()).terms_current, true);
    assert.equal((await call(v1.base, 'GET', '/api/customer/repositories', cookie)).status, 200);
  } finally {
    await new Promise((r) => v1.server.close(r));
    await v1.close();
  }

  // The operator publishes a new version (new effective date) and restarts.
  const v2 = await listen('2027-03-01');
  try {
    const me = await (await call(v2.base, 'GET', '/api/customer/me', cookie)).json();
    assert.equal(me.terms_current, false, 'still signed in, but flagged');

    for (const [method, p, body] of [
      ['GET', '/api/customer/repositories', undefined],
      ['POST', '/api/customer/repositories', { name: 'x' }],
      ['POST', '/api/customer/password', { current_password: 'a', new_password: 'b' }],
      ['GET', '/api/customer/billing/offers', undefined],
    ] as const) {
      const res = await call(v2.base, method, p, cookie, body);
      assert.equal(res.status, 403, `${method} ${p}`);
      assert.equal((await res.json()).code, 'terms_acceptance_required');
    }

    // Declining is not a trap: export is still available.
    assert.equal((await call(v2.base, 'GET', '/api/customer/export', cookie)).status, 200);
    // Accepting requires an explicit true.
    assert.equal((await call(v2.base, 'POST', '/api/customer/accept-terms', cookie, {})).status, 400);
    assert.equal((await call(v2.base, 'POST', '/api/customer/accept-terms', cookie, { accepted_terms: 'yes' })).status, 400);
    assert.equal((await call(v2.base, 'POST', '/api/customer/accept-terms', '', { accepted_terms: true })).status, 401);
    assert.equal((await call(v2.base, 'POST', '/api/customer/accept-terms', cookie, { accepted_terms: true })).status, 200);

    assert.equal((await call(v2.base, 'GET', '/api/customer/repositories', cookie)).status, 200);
    const row = v2.database.prepare('SELECT terms_accepted_version AS v FROM customer_accounts WHERE email=?').get('gate@example.com') as { v: string };
    assert.equal(row.v, '2027-03-01');
  } finally {
    await new Promise((r) => v2.server.close(r));
    await v2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
