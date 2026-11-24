import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CustomerAuth } from '../src/customerAuth.ts';
import { CustomerBilling } from '../src/customerBilling.ts';

test('signed test events grant and revoke only the paying customer plan', async () => {
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_RETURN_ORIGIN: 'http://127.0.0.1:3000', STRIPE_PRICE_INDIE: 'price_indie',
  });
  const db = new DatabaseSync(':memory:');
  try {
    const auth = new CustomerAuth(db);
    const a = auth.register('a@example.com', 'example-password');
    const b = auth.register('b@example.com', 'example-password');
    let subscriptions: unknown[] = [];
    let amount = 500;
    let sessions = 0;
    const request: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/prices/price_indie') return Response.json({
        active: true, livemode: false, currency: 'usd', unit_amount: amount, billing_scheme: 'per_unit',
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      });
      if (url.pathname === '/v1/customers') return Response.json({ id: 'cus_a' });
      if (url.pathname === '/v1/subscriptions') {
        assert.equal(url.searchParams.get('customer'), 'cus_a');
        return Response.json({ data: subscriptions, has_more: false });
      }
      assert.equal(url.pathname, '/v1/checkout/sessions');
      const body = options!.body as URLSearchParams;
      assert.equal(body.get('customer'), 'cus_a');
      assert.equal(body.get('client_reference_id'), a.id);
      assert.equal(body.get('line_items[0][price]'), 'price_indie');
      sessions++;
      return Response.json({ url: 'https://checkout.stripe.com/test' });
    };
    const billing = new CustomerBilling(db, request);
    amount = 999;
    await assert.rejects(billing.checkout(a, 'indie_solo', 'month'), /price mismatch/);
    assert.equal(sessions, 0);
    amount = 500;
    await billing.checkout(a, 'indie_solo', 'month');
    const event = (type: string) => {
      const raw = Buffer.from(JSON.stringify({ type, livemode: false, data: { object: { customer: 'cus_a' } } }));
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', 'whsec_fixture').update(t + '.').update(raw).digest('hex');
      return { raw, signature: 't=' + t + ',v1=' + sig };
    };
    const completed = event('checkout.session.completed');
    subscriptions = [{ livemode: false, customer: 'cus_a', status: 'active', items: { data: [{ price: { id: 'price_indie' } }] } }];
    assert.equal(await billing.webhook(completed.raw, 'invalid'), 400);
    const plan = (id: string) => db.prepare('SELECT plan FROM customer_accounts WHERE id=?').get(id)?.plan;
    assert.equal(plan(a.id), 'free');
    assert.equal(await billing.webhook(completed.raw, completed.signature), 200);
    assert.equal(plan(a.id), 'indie_solo');
    assert.equal(plan(b.id), 'free');
    await assert.rejects(billing.checkout(a, 'indie_solo', 'month'), /existing subscription/);
    subscriptions = [];
    const deleted = event('customer.subscription.deleted');
    assert.equal(await billing.webhook(deleted.raw, deleted.signature), 200);
    assert.equal(await billing.webhook(completed.raw, completed.signature), 200);
    assert.equal(plan(a.id), 'free');
    assert.equal(plan(b.id), 'free');
  } finally { db.close(); }
});

test('live Stripe mode enforces https origin, live events/prices, and opens billing portal', async () => {
  const prev = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_RETURN_ORIGIN: process.env.STRIPE_RETURN_ORIGIN,
    STRIPE_PRICE_INDIE: process.env.STRIPE_PRICE_INDIE,
    STRIPE_PRICE_ACADEMIC_ANNUAL: process.env.STRIPE_PRICE_ACADEMIC_ANNUAL,
  };
  const db = new DatabaseSync(':memory:');
  try {
    const auth = new CustomerAuth(db);
    const user = auth.register('live@example.com', 'example-password');

    // Live key with http://localhost origin must disable offers
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_live_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_live_fixture',
      STRIPE_RETURN_ORIGIN: 'http://localhost:3000',
      STRIPE_PRICE_INDIE: 'price_live_indie',
      STRIPE_PRICE_ACADEMIC_ANNUAL: 'price_live_acad_yr',
    });
    const badOriginBilling = new CustomerBilling(db);
    assert.equal(badOriginBilling.mode(), 'live');
    assert.deepEqual(badOriginBilling.offers(), []);

    // Live key with https origin enables offers and enforces livemode=true
    process.env.STRIPE_RETURN_ORIGIN = 'https://app.launchpadre.dev';
    let priceLivemode = false;
    const request: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/prices/price_live_acad_yr') {
        return Response.json({
          active: true,
          livemode: priceLivemode,
          currency: 'usd',
          unit_amount: 6900,
          billing_scheme: 'per_unit',
          recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' },
        });
      }
      if (url.pathname === '/v1/customers') return Response.json({ id: 'cus_live_1' });
      if (url.pathname === '/v1/subscriptions') {
        return Response.json({
          data: [
            {
              livemode: true,
              customer: 'cus_live_1',
              status: 'active',
              items: { data: [{ price: { id: 'price_live_acad_yr' } }] },
            },
          ],
          has_more: false,
        });
      }
      if (url.pathname === '/v1/billing_portal/sessions') {
        const body = options!.body as URLSearchParams;
        assert.equal(body.get('customer'), 'cus_live_1');
        assert.equal(body.get('return_url'), 'https://app.launchpadre.dev/');
        return Response.json({ url: 'https://billing.stripe.com/p/session/test_portal' });
      }
      if (url.pathname === '/v1/checkout/sessions') {
        return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_1' });
      }
      throw new Error(`Unexpected Stripe route: ${url.pathname}`);
    };

    const billing = new CustomerBilling(db, request);
    assert.equal(billing.offers().some(o => o.plan === 'academic_tier' && o.interval === 'year'), true);

    // Test-mode price must be rejected in live mode
    await assert.rejects(billing.checkout(user, 'academic_tier', 'year'), /price mismatch/);

    // Map customer and verify test-mode webhook is rejected while live-mode upgrades to academic_tier
    db.prepare('INSERT INTO stripe_customer_accounts (account_id, stripe_customer_id) VALUES (?,?)').run(
      user.id,
      'cus_live_1'
    );
    const sign = (livemode: boolean) => {
      const raw = Buffer.from(
        JSON.stringify({ type: 'checkout.session.completed', livemode, data: { object: { customer: 'cus_live_1' } } })
      );
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', 'whsec_live_fixture').update(t + '.').update(raw).digest('hex');
      return { raw, sig: `t=${t},v1=${sig}` };
    };
    const testEvt = sign(false);
    assert.equal(await billing.webhook(testEvt.raw, testEvt.sig), 400);
    const liveEvt = sign(true);
    assert.equal(await billing.webhook(liveEvt.raw, liveEvt.sig), 200);
    assert.equal(db.prepare('SELECT plan FROM customer_accounts WHERE id=?').get(user.id)?.plan, 'academic_tier');

    // Billing portal works for mapped customer
    assert.equal(billing.hasBillingAccount(user.id), true);
    const portal = await billing.portal(user);
    assert.equal(portal.url, 'https://billing.stripe.com/p/session/test_portal');
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
