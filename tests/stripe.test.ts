import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StripeClient } from '../src/stripeClient.ts';

const user = { id: 1, email: 'owner@example.com', stripe_customer_id: null };
const stripePrice = (amount: number, interval: string) => ({ active: true, currency: 'usd', unit_amount: amount,
  recurring: { interval, interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit' });

test('checkout verifies the monthly price and uses server-controlled return URLs', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const request = (async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.includes('/prices/') ? stripePrice(500, 'month') :
      { id: 'cs_test_example', url: 'https://checkout.stripe.com/c/pay/example' }), { status: 200 });
  }) as typeof fetch;
  const client = new StripeClient('test-secret', 'https://workspace.example.com', { indie_solo: 'price_example' }, request);
  const result = await client.checkout(user, 'indie_solo');
  assert.equal(result.session_id, 'cs_test_example');
  const form = new URLSearchParams(String(calls[1].options.body));
  assert.equal(form.get('line_items[0][price]'), 'price_example');
  assert.equal(form.get('client_reference_id'), '1');
  assert.equal(form.get('success_url'), 'https://workspace.example.com/?checkout=success');
  assert.equal(form.get('subscription_data[metadata][billing_interval]'), 'month');
  await assert.rejects(client.checkout(user, 'unknown'));
  assert.equal(calls.length, 2);
});

test('annual checkout selects the annual price and refuses a price mismatch before creating a session', async () => {
  let amount = 6900;
  const calls: string[] = [];
  const request = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(url.includes('/prices/') ? stripePrice(amount, 'year') :
      { id: 'cs_test_annual', url: 'https://checkout.stripe.com/c/pay/annual' }), { status: 200 });
  }) as typeof fetch;
  const client = new StripeClient('test-secret', 'https://workspace.example.com', { academic_tier_year: 'price_annual' }, request);
  assert.equal((await client.checkout(user, 'academic_tier', 'year')).billing_interval, 'year');
  assert.equal(calls[0], 'https://api.stripe.com/v1/prices/price_annual');
  amount = 9000;
  await assert.rejects(client.checkout(user, 'academic_tier', 'year'), /advertised USD amount/);
  assert.equal(calls.filter(url => url.includes('/checkout/sessions')).length, 1);
});
