import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import { CustomerAuth } from '../src/customerAuth.ts';
import { ResendMailer } from '../src/mailer.ts';
import { createApp } from '../server.ts';

test('email verification and password reset tokens: single-use, expiring, session-revoking', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const auth = new CustomerAuth(db);
  const user = auth.register('Ada@Example.com', 'original-password-1');

  // Unverified accounts are rejected only after the password is proven correct.
  assert.deepEqual(auth.login('ada@example.com', 'original-password-1'), { unverified: true });
  assert.equal(auth.login('ada@example.com', 'wrong-password-123'), null);

  const verifyToken = auth.issueToken(user.id, 'verify_email')!;
  assert.match(verifyToken, /^[a-f0-9]{64}$/);
  assert.equal(auth.issueToken(user.id, 'verify_email'), null, 'cooldown suppresses a second token');
  assert.equal(auth.verifyEmail('0'.repeat(64)), false);
  assert.equal(auth.verifyEmail(verifyToken), true);
  assert.equal(auth.verifyEmail(verifyToken), false, 'verification token is single-use');
  const first = auth.login('ada@example.com', 'original-password-1');
  assert.ok(first && 'token' in first);

  // A reset token cannot verify email and a verify token cannot reset a password.
  const resetToken = auth.issueToken(user.id, 'reset_password')!;
  assert.equal(auth.verifyEmail(resetToken), false);
  assert.throws(() => auth.resetPassword(resetToken, 'short'), /between 12 and 1024/);
  assert.equal(auth.resetPassword(resetToken, 'brand-new-password-2'), true, 'bad password did not burn the token');
  assert.equal(auth.resetPassword(resetToken, 'another-password-33'), false, 'reset token is single-use');
  assert.equal(auth.session(first.token), null, 'reset signs out existing sessions');
  assert.equal(auth.login('ada@example.com', 'original-password-1'), null);
  const second = auth.login('ada@example.com', 'brand-new-password-2');
  assert.ok(second && 'token' in second);

  // Expired tokens are rejected.
  const expiring = auth.issueToken(user.id, 'reset_password');
  assert.equal(expiring, null, 'cooldown still applies to reset tokens');
  db.prepare("UPDATE customer_tokens SET created_at=0, expires_at=1 WHERE purpose='reset_password'").run();
  const expired = auth.issueToken(user.id, 'reset_password')!;
  db.prepare('UPDATE customer_tokens SET expires_at=1 WHERE token_hash IS NOT NULL').run();
  assert.equal(auth.resetPassword(expired, 'brand-new-password-3'), false);

  // Completing a reset also verifies a still-unverified account.
  const other = auth.register('grace@example.com', 'original-password-1');
  assert.equal(auth.resetPassword(auth.issueToken(other.id, 'reset_password')!, 'grace-new-password-1'), true);
  const graceLogin = auth.login('grace@example.com', 'grace-new-password-1');
  assert.ok(graceLogin && 'token' in graceLogin);
  db.close();
});

test('accounts created before verification existed are grandfathered as verified', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE customer_accounts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','indie_solo','academic_tier')));`);
  db.prepare('INSERT INTO customer_accounts (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(
    'legacy',
    'old@example.com',
    'a:b',
    '2025-01-01T00:00:00.000Z'
  );
  new CustomerAuth(db);
  const row = db.prepare('SELECT email_verified_at FROM customer_accounts WHERE id=?').get('legacy') as {
    email_verified_at: string | null;
  };
  assert.equal(row.email_verified_at, '2025-01-01T00:00:00.000Z');
  db.close();
});

test('HTTP recovery flows send links on the configured origin and do not reveal which emails exist', async () => {
  const mails: { to: string; text: string }[] = [];
  const { app, close } = await createApp({
    workspaceDbPath: ':memory:',
    production: false,
    attachVite: false,
    mailer: { async send(m) { mails.push({ to: m.to, text: m.text }); } },
    publicOrigin: 'https://app.example.test',
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const flush = () => new Promise((r) => setTimeout(r, 20));

  try {
    assert.equal((await post('/api/customer/register', { email: 'sam@example.com', password: 'sam-password-1234' })).status, 201);
    await flush();
    // Host header must not influence the emailed link.
    assert.match(mails[0].text, /^.*https:\/\/app\.example\.test\/\?verify=[a-f0-9]{64}/s);

    const unknown = await post('/api/customer/forgot-password', { email: 'nobody@example.com' });
    const known = await post('/api/customer/forgot-password', { email: 'sam@example.com' });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(await unknown.json(), await known.json());
    await flush();
    assert.equal(mails.filter((m) => m.to === 'nobody@example.com').length, 0);
    const resetMail = mails.find((m) => m.text.includes('?reset='))!;
    const resetToken = resetMail.text.match(/\?reset=([a-f0-9]{64})/)![1];

    // Weak password is rejected without burning the token; then the reset works.
    assert.equal((await post('/api/customer/reset-password', { token: resetToken, password: 'short' })).status, 400);
    assert.equal((await post('/api/customer/reset-password', { token: resetToken, password: 'sam-new-password-99' })).status, 200);
    assert.equal((await post('/api/customer/reset-password', { token: resetToken, password: 'sam-other-password-9' })).status, 400);
    assert.equal((await post('/api/customer/login', { email: 'sam@example.com', password: 'sam-new-password-99' })).status, 200);

    // Cross-site requests to recovery endpoints are blocked like every other customer route.
    const cross = await post('/api/customer/forgot-password', { email: 'sam@example.com' }, { Origin: 'https://evil.example' });
    assert.equal(cross.status, 403);

    // Resend for a verified or unknown account sends nothing and answers the same way.
    const before = mails.length;
    assert.equal((await post('/api/customer/resend-verification', { email: 'sam@example.com' })).status, 200);
    assert.equal((await post('/api/customer/resend-verification', { email: 'nobody@example.com' })).status, 200);
    await flush();
    assert.equal(mails.length, before);
  } finally {
    await new Promise((r) => server.close(r));
    await close();
  }
});

test('production refuses to boot without mail and public origin configuration', async () => {
  const env = { ...process.env };
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  process.env.LAUNCHPADRE_ACCESS_TOKEN = 'a'.repeat(40);
  process.env.WEBHOOK_SECRET = 'b'.repeat(40);
  try {
    await assert.rejects(createApp({ workspaceDbPath: ':memory:', production: true, attachVite: false }), /RESEND_API_KEY/);
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'LaunchPadre <no-reply@example.com>';
    await assert.rejects(createApp({ workspaceDbPath: ':memory:', production: true, attachVite: false }), /PUBLIC_ORIGIN/);
    const { close } = await createApp({
      workspaceDbPath: ':memory:',
      production: true,
      attachVite: false,
      publicOrigin: 'https://app.example.com',
    });
    await close();
  } finally {
    process.env = env;
  }
});

test('ResendMailer posts the message and surfaces provider rejection', async () => {
  const calls: { url: string; body: any; auth: string }[] = [];
  const ok = new ResendMailer('re_key', 'LaunchPadre <no-reply@example.com>', async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: true, status: 200 };
  });
  await ok.send({ to: 'a@example.com', subject: 'Hi', text: 'Body' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].auth, 'Bearer re_key');
  assert.deepEqual(calls[0].body.to, ['a@example.com']);
  const bad = new ResendMailer('k', 'f', async () => ({ ok: false, status: 422 }));
  await assert.rejects(bad.send({ to: 'a@example.com', subject: 's', text: 't' }), /HTTP 422/);
});
