import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CustomerAuth } from '../src/customerAuth.ts';
import { AccountMailer, AccountRecovery } from '../src/accountRecovery.ts';

test('account links expire, are single-use, replace older requests and revoke only the reset account sessions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const auth = new CustomerAuth(db);
    const a = auth.register('a@example.com', 'original-password');
    auth.register('b@example.com', 'original-password');
    const sessionA = auth.login('a@example.com', 'original-password')!;
    const sessionB = auth.login('b@example.com', 'original-password')!;
    const recovery = new AccountRecovery(db, auth);
    assert.equal(recovery.allowEmail('a@example.com', 'reset'), true);
    assert.equal(recovery.allowEmail(' A@example.com ', 'reset'), false);
    assert.equal(recovery.allowEmail('a@example.com', 'verify'), true);
    assert.equal(recovery.issue('unknown@example.com', 'reset'), null);
    const first = recovery.issue(' A@example.com ', 'reset')!;
    const second = recovery.issue('a@example.com', 'reset')!;
    assert.equal(db.prepare('SELECT token_hash FROM customer_action_tokens').get()?.token_hash === second.token, false);
    assert.throws(() => recovery.consume(first.token, 'reset', 'replacement-password'), /invalid or expired/);
    assert.throws(() => recovery.consume(second.token, 'verify'), /invalid or expired/);
    assert.throws(() => recovery.consume(second.token, 'reset', 'short'), /12 and 1024/);
    recovery.consume(second.token, 'reset', 'replacement-password');
    assert.equal(auth.login('a@example.com', 'original-password'), null);
    assert.ok(auth.login('a@example.com', 'replacement-password'));
    assert.equal(auth.session(sessionA.token), null);
    assert.ok(auth.session(sessionB.token));
    assert.throws(() => recovery.consume(second.token, 'reset', 'another-password'), /invalid or expired/);
    const expired = recovery.issue('a@example.com', 'reset')!;
    db.prepare('UPDATE customer_action_tokens SET expires_at=0').run();
    assert.throws(() => recovery.consume(expired.token, 'reset', 'another-password'), /invalid or expired/);
    const verify = recovery.issue('a@example.com', 'verify')!;
    assert.equal(db.prepare('SELECT email_verified_at FROM customer_accounts WHERE id=?').get(a.id)?.email_verified_at, null);
    recovery.consume(verify.token, 'verify');
    assert.ok(db.prepare('SELECT email_verified_at FROM customer_accounts WHERE id=?').get(a.id)?.email_verified_at);
    assert.throws(() => recovery.consume(verify.token, 'verify'), /invalid or expired/);
    assert.equal(recovery.issue('a@example.com', 'verify'), null);
  } finally { db.close(); }
});

test('existing account schema migrates without changing passwords or sessions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE customer_accounts (id TEXT PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,created_at TEXT,plan TEXT);
      CREATE TABLE customer_sessions (token_hash TEXT PRIMARY KEY,customer_id TEXT,expires_at INTEGER);`);
    const auth = new CustomerAuth(db);
    auth.register('existing@example.com', 'original-password');
    const login = auth.login('existing@example.com', 'original-password')!;
    new CustomerAuth(db);
    assert.equal(auth.session(login.token)?.email, 'existing@example.com');
    assert.equal(auth.session(login.token)?.email_verified_at, null);
  } finally { db.close(); }
});

test('mailer uses configured origin and destination, hides tokens in URL fragments and rejects failed sends', async () => {
  let payload: Record<string, unknown> = {};
  const env = { LAUNCHPADRE_PUBLIC_ORIGIN: 'https://workspace.example.com', RESEND_API_KEY: 'fixture', LAUNCHPADRE_EMAIL_FROM: 'Workspace <hello@example.com>' };
  const mail = new AccountMailer(env, async (input, options) => {
    assert.equal(input, 'https://api.resend.com/emails');
    payload = JSON.parse(String(options!.body));
    return Response.json({ id: 'test-message' });
  });
  await mail.send('reset', 'a@example.com', 'a'.repeat(64));
  assert.deepEqual(payload.to, ['a@example.com']);
  assert.match(String(payload.text), /https:\/\/workspace.example.com\/#action=reset&token=a{64}/);
  await mail.passwordChanged('a@example.com');
  assert.equal(payload.subject, 'Your LauchPadre password changed');
  assert.equal(new AccountMailer({ ...env, LAUNCHPADRE_PUBLIC_ORIGIN: 'http://public.example.com' }).configured, false);
  assert.equal(new AccountMailer({ ...env, LAUNCHPADRE_PUBLIC_ORIGIN: 'https://workspace.example.com/another' }).configured, false);
  const failed = new AccountMailer(env, async () => new Response('', { status: 503 }));
  await assert.rejects(failed.send('verify', 'a@example.com', 'token'), /delivery failed/);
});
