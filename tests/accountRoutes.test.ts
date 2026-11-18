import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Exercise the production server's normal HTTP entry points. Outbound provider
// calls are replaced only in this disposable child process; no email is sent.
test('production account routes verify email, reset passwords, revoke sessions and expose customer billing management', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpadre-routes-'));
  const probe = net.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const mailFile = path.join(directory, 'mail.jsonl');
  const preload = path.join(directory, 'providers.mjs');
  fs.writeFileSync(preload, `
import fs from 'node:fs';
const sessions = new Map();
const attempts = new Map();
let count = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.origin === 'https://api.resend.com') {
    fs.appendFileSync(process.env.FIXTURE_MAIL_FILE, JSON.stringify(JSON.parse(options.body)) + '\\n');
    return Response.json({id:'mail_fixture'});
  }
  if (url.origin !== 'https://api.stripe.com') throw new Error('Unexpected outbound request');
  if (url.pathname.startsWith('/v1/prices/')) return Response.json({active:true,livemode:false,currency:'usd',unit_amount:500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}});
  if (url.pathname === '/v1/customers') return Response.json({id:'cus_fixture',livemode:false});
  if (url.pathname === '/v1/subscriptions') return Response.json({data:[],has_more:false});
  if (url.pathname === '/v1/billing_portal/sessions') return Response.json({url:'https://billing.stripe.com/p/session/fixture',livemode:false});
  if (url.pathname.startsWith('/v1/checkout/sessions/')) {
    const session = sessions.get(url.pathname.split('/')[4]);
    if (url.pathname.endsWith('/expire')) session.status = 'expired';
    return Response.json(session);
  }
  if (url.pathname === '/v1/checkout/sessions') {
    const key = options.headers['Idempotency-Key'];
    if (!attempts.has(key)) {
      const session = {id:'cs_fixture_'+(++count),customer:'cus_fixture',livemode:false,status:'open',url:'https://checkout.stripe.com/fixture/'+count};
      sessions.set(session.id,session); attempts.set(key,session);
    }
    return Response.json(attempts.get(key));
  }
  throw new Error('Unexpected provider request');
};
`);
  const child = spawn(process.execPath, ['--import', preload, '--import', 'tsx', 'server.ts', '--port', String(port)], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_ENV: 'production', LAUNCHPADRE_BIND_HOST: '127.0.0.1',
      LAUNCHPADRE_WORKSPACE_DB: path.join(directory, 'workspace.db'),
      LAUNCHPADRE_ACCESS_TOKEN: 'fixture-administrator-token-0123456789', WEBHOOK_SECRET: 'fixture-webhook-secret-01234567890123',
      LAUNCHPADRE_REQUIRE_VERIFIED_EMAIL: 'true', LAUNCHPADRE_PUBLIC_ORIGIN: origin,
      RESEND_API_KEY: 'fixture', LAUNCHPADRE_EMAIL_FROM: 'test@example.com', FIXTURE_MAIL_FILE: mailFile,
      STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_RETURN_ORIGIN: origin,
      STRIPE_PRICE_INDIE: 'price_indie', STRIPE_PRICE_INDIE_ANNUAL: '', STRIPE_PRICE_ACADEMIC: '', STRIPE_PRICE_ACADEMIC_ANNUAL: '',
    },
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  async function request(route: string, data?: unknown, cookie?: string) {
    const response = await fetch(origin + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await request('/readyz')).status === 200) { ready = true; break; } } catch {}
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    const a = { email: 'account-a@example.com', password: 'original-password' };
    const b = { email: 'account-b@example.com', password: 'original-password' };
    assert.equal((await request('/api/customer/register', a)).status, 201);
    assert.equal((await request('/api/customer/register', b)).status, 201);
    const loginA = await request('/api/customer/login', a);
    const loginB = await request('/api/customer/login', b);
    assert.equal((await request('/api/customer/billing/checkout', { plan: 'indie_solo', interval: 'month' }, loginA.cookie)).status, 403);
    assert.equal((await request('/api/customer/request-verification', {}, loginA.cookie)).status, 200);
    const messages = () => fs.readFileSync(mailFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const verify = messages().find(mail => mail.subject.startsWith('Verify')).text.match(/token=([a-f0-9]{64})/)[1];
    assert.equal((await request('/api/customer/verify-email', { token: verify })).status, 200);
    assert.equal((await request('/api/customer/verify-email', { token: verify })).status, 400);
    const known = await request('/api/customer/request-reset', { email: a.email });
    const unknown = await request('/api/customer/request-reset', { email: 'unknown@example.com' });
    assert.equal(known.status, 202); assert.deepEqual(known.body, unknown.body);
    const reset = messages().find(mail => mail.subject.startsWith('Reset')).text.match(/token=([a-f0-9]{64})/)[1];
    assert.equal((await request('/api/customer/reset-password', { token: reset, password: 'short' })).status, 400);
    assert.equal((await request('/api/customer/reset-password', { token: reset, password: 'replacement-password' })).status, 200);
    assert.ok(messages().some(mail => mail.subject === 'Your LauchPadre password changed'));
    assert.equal((await request('/api/customer/me', undefined, loginA.cookie)).status, 401);
    assert.equal((await request('/api/customer/me', undefined, loginB.cookie)).status, 200);
    assert.equal((await request('/api/customer/login', a)).status, 401);
    const login = await request('/api/customer/login', { ...a, password: 'replacement-password' });
    assert.equal(login.status, 200);
    const checkout = await request('/api/customer/billing/checkout', { plan: 'indie_solo', interval: 'month' }, login.cookie);
    assert.equal(checkout.status, 200);
    assert.equal((await request('/api/customer/billing/portal', {}, login.cookie)).status, 200);
    assert.equal((await request('/api/customer/billing/cancel-checkout', {}, login.cookie)).status, 200);
    const next = await request('/api/customer/billing/checkout', { plan: 'indie_solo', interval: 'month' }, login.cookie);
    assert.equal(next.status, 200); assert.notEqual(checkout.body.url, next.body.url);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
