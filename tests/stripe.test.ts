import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StripeClient } from '../src/stripeClient.ts';

test('checkout uses configured prices and server-controlled return URLs', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const request = (async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 'cs_test_example', url: 'https://checkout.stripe.com/c/pay/example' }), { status: 200 });
  }) as typeof fetch;
  const client = new StripeClient('test-secret', 'https://workspace.example.com', { indie_solo: 'price_example' }, request);
  const result = await client.checkout({ id: 1, email: 'owner@example.com', stripe_customer_id: null }, 'indie_solo');
  assert.equal(result.session_id, 'cs_test_example');
  const form = new URLSearchParams(String(calls[0].options.body));
  assert.equal(form.get('line_items[0][price]'), 'price_example');
  assert.equal(form.get('client_reference_id'), '1');
  assert.equal(form.get('success_url'), 'https://workspace.example.com/?checkout=success');
  await assert.rejects(client.checkout({ id: 1, email: 'owner@example.com', stripe_customer_id: null }, 'unknown'));
  assert.equal(calls.length, 1);
});
