import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PLANS } from './plans.ts';

type Attempt = { attempt_id: string; price_id: string; session_id: string | null; created_at: number };

export class CustomerBilling {
  readonly mode = process.env.STRIPE_MODE || 'test';
  private key = process.env.STRIPE_SECRET_KEY || '';
  private secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  private origin = process.env.STRIPE_RETURN_ORIGIN || '';
  private prices = [
    { plan: 'indie_solo', interval: 'month', id: process.env.STRIPE_PRICE_INDIE },
    { plan: 'indie_solo', interval: 'year', id: process.env.STRIPE_PRICE_INDIE_ANNUAL },
    { plan: 'academic_tier', interval: 'month', id: process.env.STRIPE_PRICE_ACADEMIC },
    { plan: 'academic_tier', interval: 'year', id: process.env.STRIPE_PRICE_ACADEMIC_ANNUAL },
  ] as const;

  constructor(private db: DatabaseSync, private request = fetch) {
    if (!['test', 'live'].includes(this.mode)) throw new Error('STRIPE_MODE must be test or live');
    const priceIds = this.prices.map(price => price.id).filter(Boolean);
    if (new Set(priceIds).size !== priceIds.length) throw new Error('Each Stripe offer needs a different price ID');
    db.exec(`CREATE TABLE IF NOT EXISTS stripe_customer_accounts (
      account_id TEXT PRIMARY KEY REFERENCES customer_accounts(id), stripe_customer_id TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS stripe_customer_mappings (
      account_id TEXT NOT NULL REFERENCES customer_accounts(id), mode TEXT NOT NULL,
      stripe_customer_id TEXT NOT NULL, PRIMARY KEY(account_id,mode), UNIQUE(mode,stripe_customer_id)
    );
    INSERT OR IGNORE INTO stripe_customer_mappings SELECT account_id,'test',stripe_customer_id FROM stripe_customer_accounts;
    CREATE TABLE IF NOT EXISTS stripe_checkout_attempts (
      account_id TEXT NOT NULL REFERENCES customer_accounts(id), mode TEXT NOT NULL,
      attempt_id TEXT NOT NULL UNIQUE, price_id TEXT NOT NULL, session_id TEXT,
      created_at INTEGER NOT NULL, PRIMARY KEY(account_id,mode)
    );
    CREATE TABLE IF NOT EXISTS stripe_billing_reviews (
      event_id TEXT PRIMARY KEY, mode TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES customer_accounts(id),
      event_type TEXT NOT NULL, object_id TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stripe_reconciliation_versions (
      account_id TEXT NOT NULL REFERENCES customer_accounts(id), mode TEXT NOT NULL, generation INTEGER NOT NULL,
      PRIMARY KEY(account_id,mode)
    )`);
  }

  private configured() {
    return new RegExp(`^(sk|rk)_${this.mode}_`).test(this.key) && this.secret.startsWith('whsec_');
  }

  offers() {
    // Academic checkout stays unavailable until customer Zenodo workflows ship.
    if (!this.configured()) return [];
    try { this.returnOrigin(); } catch { return []; }
    return this.prices.filter(p => p.id?.startsWith('price_') && p.plan !== 'academic_tier').map(p => ({
      plan: p.plan, interval: p.interval, name: PLANS[p.plan].name,
      cents: p.interval === 'month' ? PLANS[p.plan].monthly : PLANS[p.plan].annual,
    }));
  }

  details(accountId: string) {
    return {
      mode: this.mode,
      portal_available: this.configured() && Boolean(this.mapping(accountId)),
      review_pending: Boolean(this.db.prepare('SELECT 1 FROM stripe_billing_reviews WHERE account_id=? AND mode=? AND resolved_at IS NULL LIMIT 1').get(accountId, this.mode)),
      checkout_pending: Boolean(this.attempt(accountId)),
    };
  }

  private mapping(accountId: string) {
    return this.db.prepare('SELECT stripe_customer_id FROM stripe_customer_mappings WHERE account_id=? AND mode=?')
      .get(accountId, this.mode) as { stripe_customer_id: string } | undefined;
  }

  private returnOrigin() {
    const origin = new URL(this.origin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.origin !== this.origin || origin.username || origin.password ||
        (origin.protocol !== 'https:' && !(this.mode === 'test' && origin.protocol === 'http:' && loopback))) {
      throw new Error('Invalid Stripe return origin');
    }
    return origin.origin;
  }

  private async stripe(route: string, body?: URLSearchParams, idempotencyKey?: string) {
    const response = await this.request('https://api.stripe.com/v1/' + route, {
      method: body ? 'POST' : 'GET', body, redirect: 'error',
      headers: { Authorization: 'Bearer ' + this.key, 'Stripe-Version': '2026-10-28.endive', ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Stripe request failed');
    return response.json();
  }

  private attempt(accountId: string) {
    return this.db.prepare('SELECT attempt_id,price_id,session_id,created_at FROM stripe_checkout_attempts WHERE account_id=? AND mode=?')
      .get(accountId, this.mode) as Attempt | undefined;
  }

  async checkout(account: { id: string; email: string }, plan: string, interval: string) {
    const offer = this.offers().find(p => p.plan === plan && p.interval === interval);
    const price = this.prices.find(p => p.plan === plan && p.interval === interval)?.id;
    if (!offer || !price) throw new Error('Checkout unavailable');
    const origin = this.returnOrigin();
    const details = await this.stripe('prices/' + encodeURIComponent(price));
    if (!details.active || details.livemode !== (this.mode === 'live') || details.currency !== 'usd' || details.unit_amount !== offer.cents ||
        details.recurring?.interval !== interval || details.recurring?.interval_count !== 1 ||
        details.recurring?.usage_type !== 'licensed' || details.billing_scheme !== 'per_unit') throw new Error('Stripe price mismatch');
    let mapping = this.mapping(account.id);
    if (!mapping) {
      const customer = await this.stripe('customers', new URLSearchParams({ email: account.email }), 'launchpadre-customer-' + this.mode + '-' + account.id);
      if (typeof customer.id !== 'string' || !customer.id.startsWith('cus_') || customer.livemode !== (this.mode === 'live')) throw new Error('Invalid Stripe customer');
      this.db.prepare('INSERT OR IGNORE INTO stripe_customer_mappings VALUES (?,?,?)').run(account.id, this.mode, customer.id);
      mapping = this.mapping(account.id);
    }
    const customer = mapping!.stripe_customer_id;
    const subscriptions = await this.subscriptions(customer);
    if (subscriptions.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) throw new Error('Manage the existing subscription in Stripe');
    let attempt = this.attempt(account.id);
    if (attempt?.session_id) {
      const session = await this.stripe('checkout/sessions/' + encodeURIComponent(attempt.session_id));
      if (session.customer !== customer || session.livemode !== (this.mode === 'live')) throw new Error('Invalid checkout customer');
      if (session.status === 'open') {
        if (attempt.price_id !== price) throw new Error('Finish or expire the existing checkout before choosing another plan');
        return this.checkoutUrl(session);
      }
      if (session.status === 'complete') {
        // A completed checkout might still await subscription reconciliation.
        const subscription = typeof session.subscription === 'string' ? await this.stripe('subscriptions/' + encodeURIComponent(session.subscription)) : null;
        if (!subscription || !['canceled', 'incomplete_expired'].includes(subscription.status)) throw new Error('Manage the existing subscription in Stripe');
      } else if (session.status !== 'expired') throw new Error('Checkout status is unavailable');
      this.db.prepare('DELETE FROM stripe_checkout_attempts WHERE account_id=? AND mode=? AND attempt_id=?').run(account.id, this.mode, attempt.attempt_id);
      attempt = undefined;
    }
    if (attempt && Date.now() - attempt.created_at > 23 * 60 * 60_000) {
      throw new Error('An interrupted checkout needs operator reconciliation before retrying');
    }
    this.db.prepare('INSERT OR IGNORE INTO stripe_checkout_attempts VALUES (?,?,?,?,NULL,?)')
      .run(account.id, this.mode, randomUUID(), price, Date.now());
    attempt = this.attempt(account.id)!;
    if (attempt.price_id !== price) throw new Error('A different checkout is already in progress');
    const identifier = Array.from(createHash('sha256').update(attempt.attempt_id).digest().subarray(0, 8), byte => String.fromCharCode(97 + byte % 26)).join('');
    const session = await this.stripe('checkout/sessions', new URLSearchParams({
      mode: 'subscription', customer, client_reference_id: account.id,
      'line_items[0][price]': price, 'line_items[0][quantity]': '1',
      success_url: origin + '/?checkout=success', cancel_url: origin + '/?checkout=canceled',
      integration_identifier: 'launchpadre_' + identifier,
    }), 'launchpadre-checkout-' + attempt.attempt_id);
    if (typeof session.id !== 'string' || !session.id.startsWith('cs_') || session.livemode !== (this.mode === 'live') || session.customer !== customer) throw new Error('Invalid checkout session');
    this.db.prepare('UPDATE stripe_checkout_attempts SET session_id=? WHERE account_id=? AND mode=? AND attempt_id=?')
      .run(session.id, account.id, this.mode, attempt.attempt_id);
    return this.checkoutUrl(session);
  }

  private checkoutUrl(session: { url?: unknown }) {
    if (typeof session.url !== 'string' || new URL(session.url).origin !== 'https://checkout.stripe.com') throw new Error('Invalid checkout URL');
    return { url: session.url };
  }

  async portal(accountId: string) {
    const customer = this.mapping(accountId);
    if (!this.configured() || !customer) throw new Error('Billing portal unavailable');
    const body = new URLSearchParams({ customer: customer.stripe_customer_id, return_url: this.returnOrigin() });
    if (process.env.STRIPE_PORTAL_CONFIGURATION) body.set('configuration', process.env.STRIPE_PORTAL_CONFIGURATION);
    const session = await this.stripe('billing_portal/sessions', body);
    if (typeof session.url !== 'string' || new URL(session.url).origin !== 'https://billing.stripe.com' || session.livemode !== (this.mode === 'live')) throw new Error('Invalid billing portal URL');
    return { url: session.url };
  }

  async cancelCheckout(accountId: string) {
    const attempt = this.attempt(accountId);
    const customer = this.mapping(accountId);
    if (!this.configured() || !customer || !attempt?.session_id) throw new Error('No cancellable checkout is available');
    const route = 'checkout/sessions/' + encodeURIComponent(attempt.session_id);
    const session = await this.stripe(route);
    if (session.customer !== customer.stripe_customer_id || session.livemode !== (this.mode === 'live')) throw new Error('Invalid checkout customer');
    if (session.status === 'open') await this.stripe(route + '/expire', new URLSearchParams(), 'launchpadre-expire-' + attempt.attempt_id);
    else if (session.status !== 'expired') throw new Error('This checkout has already completed');
    this.db.prepare('DELETE FROM stripe_checkout_attempts WHERE account_id=? AND mode=? AND attempt_id=?').run(accountId, this.mode, attempt.attempt_id);
    return { status: 'canceled' };
  }

  private async subscriptions(customer: string) {
    const items: any[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ customer, status: 'all', limit: '100' });
      if (cursor) query.set('starting_after', cursor);
      const page = await this.stripe('subscriptions?' + query);
      if (!Array.isArray(page.data)) throw new Error('Invalid Stripe subscription response');
      items.push(...page.data);
      cursor = page.has_more ? page.data.at(-1)?.id : undefined;
      if (page.has_more && !cursor) throw new Error('Invalid Stripe pagination');
    } while (cursor);
    return items;
  }

  async webhook(raw: Buffer, header: string): Promise<number> {
    if (!this.configured()) return 503;
    const fields = header.split(',').map(part => part.trim());
    const stamp = fields.find(part => part.startsWith('t='))?.slice(2) || '';
    if (!/^\d+$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 300) return 400;
    const expected = createHmac('sha256', this.secret).update(stamp + '.').update(raw).digest();
    if (!fields.some(part => /^v1=[a-f0-9]{64}$/i.test(part) && timingSafeEqual(expected, Buffer.from(part.slice(3), 'hex')))) return 400;
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return 400; }
    if (event?.livemode !== (this.mode === 'live')) return 400;
    const lifecycle = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed'];
    const risk = ['charge.refunded', 'charge.dispute.created', 'radar.early_fraud_warning.created'];
    if (![...lifecycle, ...risk].includes(event.type)) return 200;
    const object = event.data?.object;
    let customer = object?.customer;
    if (risk.includes(event.type) && typeof customer !== 'string' && typeof object?.charge === 'string') {
      customer = (await this.stripe('charges/' + encodeURIComponent(object.charge))).customer;
    }
    if (typeof customer !== 'string') return 400;
    const owner = this.db.prepare('SELECT account_id FROM stripe_customer_mappings WHERE stripe_customer_id=? AND mode=?').get(customer, this.mode);
    if (!owner) return 200;
    if (risk.includes(event.type)) {
      if (typeof event.id !== 'string' || typeof object.id !== 'string') return 400;
      this.db.prepare('INSERT OR IGNORE INTO stripe_billing_reviews (event_id,mode,account_id,event_type,object_id,created_at) VALUES (?,?,?,?,?,?)')
        .run(event.id, this.mode, owner.account_id, event.type, object.id, new Date().toISOString());
    }
    const version = this.db.prepare(`INSERT INTO stripe_reconciliation_versions VALUES (?,?,1)
      ON CONFLICT(account_id,mode) DO UPDATE SET generation=generation+1 RETURNING generation`)
      .get(owner.account_id, this.mode)!;
    const subscriptions = await this.subscriptions(customer);
    const activePrices = new Set(subscriptions.filter(s => s.livemode === (this.mode === 'live') && s.customer === customer && ['active', 'trialing'].includes(s.status))
      .flatMap(s => s.items?.data?.map((item: any) => item.price?.id) || []));
    const matching = this.prices.filter(p => p.id && activePrices.has(p.id));
    const plan = matching.some(p => p.plan === 'academic_tier') ? 'academic_tier' : matching.length ? 'indie_solo' : 'free';
    this.db.prepare(`UPDATE customer_accounts SET plan=?,billing_mode=? WHERE id=? AND EXISTS
      (SELECT 1 FROM stripe_reconciliation_versions WHERE account_id=? AND mode=? AND generation=?)`)
      .run(plan, this.mode, owner.account_id, owner.account_id, this.mode, version.generation);
    return 200;
  }
}
