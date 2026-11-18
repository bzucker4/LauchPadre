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
