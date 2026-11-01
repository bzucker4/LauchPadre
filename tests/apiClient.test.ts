import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError, requestJson } from '../src/apiClient.ts';

test('missing server configuration is a valid availability response', async () => {
  const body = { plans: [{ id: 'indie_solo', monthly_checkout: false, annual_checkout: false }] };
  const request = (async () => Response.json(body)) as typeof fetch;
  assert.deepEqual(await requestJson('/api/v1/billing/plans', {}, request), body);
});

test('billing failures distinguish missing endpoints, expired sessions and stopped servers', async () => {
  for (const [status, kind] of [[404, 'endpoint'], [401, 'session']] as const) {
    await assert.rejects(requestJson('/api/v1/billing/plans', {}, (async () => Response.json({ error: 'Failure' }, { status })) as typeof fetch),
      error => error instanceof ApiRequestError && error.kind === kind && error.status === status);
  }
  await assert.rejects(requestJson('/api/v1/billing/plans', {}, (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch),
    error => error instanceof ApiRequestError && error.kind === 'network');
  await assert.rejects(requestJson('/api/v1/billing/plans', {}, (async () => new Response('<html>Old frontend</html>')) as typeof fetch),
    error => error instanceof ApiRequestError && error.kind === 'server');
});

test('wrong passwords stay a login error rather than expiring another session', async () => {
  await assert.rejects(requestJson('/api/auth/login', {}, (async () => Response.json({ error: 'Invalid workspace password' }, { status: 401 })) as typeof fetch),
    error => error instanceof ApiRequestError && error.kind === 'request' && error.message === 'Invalid workspace password');
});

test('a protected 401 asks the browser to sign in again', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browser = new EventTarget(); let expired = 0;
  browser.addEventListener('launchpadre:session-expired', () => { expired++; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  try {
    await assert.rejects(requestJson('/api/v1/billing/plans', {}, (async () => Response.json({}, { status: 401 })) as typeof fetch));
    assert.equal(expired, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
