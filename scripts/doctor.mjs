import 'dotenv/config';
import { WORKSPACE_API_VERSION } from '../src/apiVersion.ts';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const base = `http://127.0.0.1:${port}`;
const check = async (route, options = {}) => {
  const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(5000) });
  const body = await response.json().catch(() => null);
  return { response, body };
};
try {
  const health = await check('/healthz');
  if (!health.response.ok || health.body?.status !== 'ok') throw new Error('Port is occupied, but the expected LaunchPadre health endpoint is unavailable.');
  console.log(`Server reachable at ${base} (${health.body.mode} mode).`);
  const version = await check('/api/version');
  if (!version.response.ok || version.body?.api_version !== WORKSPACE_API_VERSION) throw new Error('The running server is out of date or incompatible. Stop it with Ctrl+C, run git pull --ff-only and npm run local, then reload.');
  console.log('Server API version matches this installation.');
  if (!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is missing from the local configuration.');
  const login = await check('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
  if (!login.response.ok || !cookie) throw new Error('Local sign-in failed. Check the password in .env and restart the server after configuration changes.');
  try {
    const plans = await check('/api/v1/billing/plans', { headers: { cookie } });
    if (!plans.response.ok || !Array.isArray(plans.body?.plans)) throw new Error(`Billing availability failed (HTTP ${plans.response.status}).`);
    const available = plans.body.plans.some(plan => plan.monthly_checkout || plan.annual_checkout);
    console.log('Billing endpoint responds correctly.');
    console.log(available ? 'Checkout configuration is present; actual Stripe credentials still need account verification.' : 'Payments are not configured. This is expected for local Git and task use.');
  } finally {
    await check('/api/auth/logout', { method: 'POST', headers: { cookie } }).catch(() => {});
  }
  console.log('Diagnostics complete. No passwords, tokens, or customer data were printed.');
} catch (error) {
  console.error(error instanceof TypeError ? 'Cannot reach the local server. Start npm run local in another terminal and retry.' : error.message);
  process.exitCode = 1;
}
