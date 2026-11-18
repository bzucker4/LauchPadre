import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const publicLaunch = process.argv.includes('--public');
const mode = process.env.STRIPE_MODE || 'test';
let origin;
try { origin = new URL(process.env.LAUNCHPADRE_PUBLIC_ORIGIN || ''); } catch {}
const gitRoot = process.env.LAUNCHPADRE_CUSTOMER_GIT_ROOT;
const checks = {
  node_24_or_newer: Number(process.versions.node.split('.')[0]) >= 24,
  built_client: fs.existsSync(new URL('../dist/index.html', import.meta.url)),
  administrator_token: (process.env.LAUNCHPADRE_ACCESS_TOKEN || '').length >= 32,
  webhook_secret: (process.env.WEBHOOK_SECRET || '').length >= 32,
  customer_git_directory: Boolean(gitRoot && path.isAbsolute(gitRoot) && fs.existsSync(gitRoot) && fs.statSync(gitRoot).isDirectory()),
  billing_mode: ['test', 'live'].includes(mode),
};
if (publicLaunch) {
  Object.assign(checks, {
    public_https_origin: Boolean(origin && origin.protocol === 'https:' && origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password),
    email_sender_configured: Boolean(process.env.RESEND_API_KEY && process.env.LAUNCHPADRE_EMAIL_FROM),
    email_verification_enabled: process.env.LAUNCHPADRE_REQUIRE_VERIFIED_EMAIL === 'true',
    support_email_configured: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.LAUNCHPADRE_SUPPORT_EMAIL || ''),
    privacy_url_configured: (process.env.LAUNCHPADRE_PRIVACY_URL || '').startsWith('https://'),
    terms_url_configured: (process.env.LAUNCHPADRE_TERMS_URL || '').startsWith('https://'),
    live_billing_key: mode === 'live' && /^(rk|sk)_live_/.test(process.env.STRIPE_SECRET_KEY || ''),
    stripe_webhook_configured: (process.env.STRIPE_WEBHOOK_SECRET || '').startsWith('whsec_'),
    indie_price_configured: (process.env.STRIPE_PRICE_INDIE || '').startsWith('price_') || (process.env.STRIPE_PRICE_INDIE_ANNUAL || '').startsWith('price_'),
    billing_return_matches_public_origin: Boolean(origin && process.env.STRIPE_RETURN_ORIGIN === origin.origin),
  });
}
console.log(JSON.stringify({ configuration_only: true, profile: publicLaunch ? 'public' : 'local', checks }, null, 2));
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
