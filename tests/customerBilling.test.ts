import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CustomerAuth } from '../src/customerAuth.ts';
import { CustomerBilling } from '../src/customerBilling.ts';

test('billing separates modes, deduplicates checkout, supports cancellation and reconciles signed events', async () => {
  for (const mode of ['test', 'live']) {
    Object.assign(process.env, {
      STRIPE_MODE: mode, STRIPE_SECRET_KEY: `rk_${mode}_fixture`, STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_RETURN_ORIGIN: 'https://workspace.example.com', STRIPE_PRICE_INDIE: 'price_indie',
      STRIPE_PRICE_INDIE_ANNUAL: 'price_year', STRIPE_PRICE_ACADEMIC: 'price_academic',
      STRIPE_PRICE_ACADEMIC_ANNUAL: 'price_academic_year',
    });
    const db = new DatabaseSync(':memory:');
    try {
      const auth = new CustomerAuth(db);
      const a = auth.register('a@example.com', 'example-password');
      const b = auth.register('b@example.com', 'example-password');
      const login = auth.login('a@example.com', 'example-password')!;
      const customer = 'cus_a_' + mode;
      let subscriptions: any[] = [];
      let amount = 500;
      let creations = 0;
      const sessions = new Map<string, any>();
      const idempotency = new Map<string, any>();
      let lastSession: any;
      const request: typeof fetch = async (input, options) => {
        const url = new URL(String(input));
        const live = mode === 'live';
        assert.equal((options!.headers as Record<string, string>)['Stripe-Version'], '2026-10-28.endive');
        if (url.pathname.startsWith('/v1/prices/')) return Response.json({
          active: true, livemode: live, currency: 'usd', unit_amount: amount, billing_scheme: 'per_unit',
          recurring: { interval: url.pathname.endsWith('price_year') ? 'year' : 'month', interval_count: 1, usage_type: 'licensed' },
        });
        if (url.pathname === '/v1/customers') return Response.json({ id: customer, livemode: live });
        if (url.pathname === '/v1/subscriptions') {
          assert.equal(url.searchParams.get('customer'), customer);
          return Response.json({ data: subscriptions, has_more: false });
        }
        if (url.pathname.startsWith('/v1/subscriptions/')) return Response.json({ id: 'sub_a', status: 'canceled', customer, livemode: live });
        if (url.pathname === '/v1/charges/ch_fixture') return Response.json({ id: 'ch_fixture', customer, livemode: live });
        if (url.pathname === '/v1/billing_portal/sessions') {
          const body = options!.body as URLSearchParams;
          assert.equal(body.get('customer'), customer);
          return Response.json({ url: 'https://billing.stripe.com/p/session/test', livemode: live });
        }
        if (url.pathname.startsWith('/v1/checkout/sessions/')) {
          const id = url.pathname.split('/')[4];
          const session = sessions.get(id);
          assert.ok(session);
          if (url.pathname.endsWith('/expire')) session.status = 'expired';
          return Response.json(session);
        }
        assert.equal(url.pathname, '/v1/checkout/sessions');
        const body = options!.body as URLSearchParams;
        assert.equal(body.get('customer'), customer);
        assert.equal(body.get('client_reference_id'), a.id);
        assert.equal(body.get('line_items[0][price]'), 'price_indie');
        assert.match(body.get('integration_identifier')!, /^launchpadre_[a-z]{8}$/);
        const key = (options!.headers as Record<string, string>)['Idempotency-Key'];
        if (!idempotency.has(key)) {
          creations++;
          lastSession = { id: 'cs_' + creations, customer, status: 'open', livemode: live, url: 'https://checkout.stripe.com/session/' + creations };
          idempotency.set(key, lastSession); sessions.set(lastSession.id, lastSession);
        }
        return Response.json(idempotency.get(key));
      };
      const billing = new CustomerBilling(db, request);
      assert.equal(billing.offers().some(offer => offer.plan === 'academic_tier'), false);
      amount = 999;
      await assert.rejects(billing.checkout(a, 'indie_solo', 'month'), /price mismatch/);
      assert.equal(creations, 0);
      amount = 500;
      const results = await Promise.all([billing.checkout(a, 'indie_solo', 'month'), billing.checkout(a, 'indie_solo', 'month')]);
      assert.deepEqual(results[0], results[1]); assert.equal(creations, 1);
      await billing.checkout(a, 'indie_solo', 'month'); assert.equal(creations, 1);
      amount = 3900;
      await assert.rejects(billing.checkout(a, 'indie_solo', 'year'), /existing checkout/);
      amount = 500;
      assert.equal((await billing.portal(a.id)).url, 'https://billing.stripe.com/p/session/test');
      await assert.rejects(billing.portal(b.id), /unavailable/);
      assert.equal((await billing.cancelCheckout(a.id)).status, 'canceled');
      await billing.checkout(a, 'indie_solo', 'month'); assert.equal(creations, 2);
      lastSession.status = 'complete'; lastSession.subscription = 'sub_a';
      const event = (type: string, object: Record<string, unknown> = { customer }, livemode = mode === 'live') => {
        const raw = Buffer.from(JSON.stringify({ id: 'evt_' + type, type, livemode, data: { object } }));
        const t = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', 'whsec_fixture').update(t + '.').update(raw).digest('hex');
        return { raw, signature: 't=' + t + ',v1=' + sig };
      };
      const deliver = async (type: string, object?: Record<string, unknown>) => {
        const e = event(type, object); return billing.webhook(e.raw, e.signature);
      };
      subscriptions = [{ livemode: mode === 'live', customer, status: 'active', items: { data: [{ price: { id: 'price_indie' } }] } }];
      const completed = event('checkout.session.completed');
      assert.equal(await billing.webhook(completed.raw, 'invalid'), 400);
      const opposite = event('checkout.session.completed', { customer }, mode !== 'live');
      assert.equal(await billing.webhook(opposite.raw, opposite.signature), 400);
      assert.equal(await billing.webhook(completed.raw, completed.signature), 200);
      assert.equal(auth.session(login.token)?.plan, 'indie_solo');
      process.env.STRIPE_MODE = mode === 'live' ? 'test' : 'live';
      assert.equal(auth.session(login.token)?.plan, 'free', 'other-mode access must never inherit a paid plan');
      process.env.STRIPE_MODE = mode;
      assert.equal(db.prepare('SELECT plan FROM customer_accounts WHERE id=?').get(b.id)?.plan, 'free');
      await assert.rejects(billing.checkout(a, 'indie_solo', 'month'), /existing subscription/);
      subscriptions[0].status = 'past_due';
      assert.equal(await deliver('invoice.payment_failed'), 200);
      assert.equal(auth.session(login.token)?.plan, 'free');
      subscriptions[0].status = 'active';
      assert.equal(await deliver('invoice.paid'), 200);
      assert.equal(auth.session(login.token)?.plan, 'indie_solo');
      assert.equal(await deliver('charge.dispute.created', { id: 'dp_fixture', charge: 'ch_fixture' }), 200);
      assert.equal(await deliver('charge.dispute.created', { id: 'dp_fixture', charge: 'ch_fixture' }), 200);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stripe_billing_reviews').get()?.count, 1);
      assert.equal(billing.details(a.id).review_pending, true);
      subscriptions = [];
      assert.equal(await deliver('customer.subscription.deleted'), 200);
      assert.equal(await billing.webhook(completed.raw, completed.signature), 200);
      assert.equal(auth.session(login.token)?.plan, 'free');
      await billing.checkout(a, 'indie_solo', 'month');
      assert.equal(creations, 3, 'repurchase after cancellation must start a fresh checkout');
    } finally { db.close(); }
  }
  delete process.env.STRIPE_MODE;
});

test('legacy customer mappings migrate to test mode and mismatched keys cannot offer checkout', () => {
  Object.assign(process.env, { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_RETURN_ORIGIN: 'http://127.0.0.1:3000' });
  const db = new DatabaseSync(':memory:');
  try {
    const auth = new CustomerAuth(db);
    const account = auth.register('legacy@example.com', 'example-password');
    db.exec('CREATE TABLE stripe_customer_accounts (account_id TEXT PRIMARY KEY, stripe_customer_id TEXT UNIQUE)');
    db.prepare('INSERT INTO stripe_customer_accounts VALUES (?,?)').run(account.id, 'cus_legacy');
    assert.equal(new CustomerBilling(db).details(account.id).portal_available, true);
    process.env.STRIPE_MODE = 'live';
    const live = new CustomerBilling(db);
    assert.equal(live.details(account.id).portal_available, false);
    assert.deepEqual(live.offers(), []);
  } finally { db.close(); delete process.env.STRIPE_MODE; }
});

test('a slow earlier webhook cannot overwrite a newer cancellation reconciliation', async () => {
  Object.assign(process.env, { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_INDIE: 'price_indie' });
  const db = new DatabaseSync(':memory:');
  try {
    const auth = new CustomerAuth(db);
    const account = auth.register('concurrent@example.com', 'example-password');
    let release: (value: Response) => void;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    let calls = 0;
    const billing = new CustomerBilling(db, async () => {
      calls++;
      return calls === 1 ? delayed : Response.json({ data: [], has_more: false });
    });
    db.prepare('INSERT INTO stripe_customer_mappings VALUES (?,?,?)').run(account.id, 'test', 'cus_concurrent');
    const raw = Buffer.from(JSON.stringify({ type: 'customer.subscription.updated', livemode: false, data: { object: { customer: 'cus_concurrent' } } }));
    const t = Math.floor(Date.now() / 1000);
    const signature = 't=' + t + ',v1=' + createHmac('sha256', 'whsec_fixture').update(t + '.').update(raw).digest('hex');
    const older = billing.webhook(raw, signature);
    assert.equal(calls, 1);
    assert.equal(await billing.webhook(raw, signature), 200);
    release!(Response.json({ data: [{ customer: 'cus_concurrent', livemode: false, status: 'active', items: { data: [{ price: { id: 'price_indie' } }] } }], has_more: false }));
    assert.equal(await older, 200);
    assert.equal(db.prepare('SELECT plan FROM customer_accounts WHERE id=?').get(account.id)?.plan, 'free');
  } finally { db.close(); delete process.env.STRIPE_MODE; }
});
