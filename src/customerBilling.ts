import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PLANS } from './plans.ts';

export class CustomerBilling {
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
    db.exec(`CREATE TABLE IF NOT EXISTS stripe_customer_accounts (
      account_id TEXT PRIMARY KEY REFERENCES customer_accounts(id),
      stripe_customer_id TEXT NOT NULL UNIQUE
    )`);
  }

  private configured() {
    return /^(sk|rk)_test_/.test(this.key) && this.secret.startsWith('whsec_');
  }

  offers() {
    return this.configured() && this.origin ? this.prices.filter(p => p.id?.startsWith('price_')).map(p => ({
      plan: p.plan, interval: p.interval, name: PLANS[p.plan].name,
      cents: p.interval === 'month' ? PLANS[p.plan].monthly : PLANS[p.plan].annual,
    })) : [];
  }

  private async stripe(route: string, body?: URLSearchParams, idempotencyKey?: string) {
    const response = await this.request('https://api.stripe.com/v1/' + route, {
      method: body ? 'POST' : 'GET', body, redirect: 'error',
      headers: { Authorization: 'Bearer ' + this.key, ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Stripe request failed');
    return response.json();
  }

  async checkout(account: {id: string; email: string}, plan: string, interval: string) {
    const offer = this.offers().find(p => p.plan === plan && p.interval === interval);
    const price = this.prices.find(p => p.plan === plan && p.interval === interval)?.id;
    if (!offer || !price) throw new Error('Checkout unavailable');
    const origin = new URL(this.origin);
    if (origin.origin !== this.origin || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Invalid Stripe return origin');
    const details = await this.stripe('prices/' + encodeURIComponent(price));
    if (!details.active || details.livemode !== false || details.currency !== 'usd' || details.unit_amount !== offer.cents ||
        details.recurring?.interval !== interval || details.recurring?.interval_count !== 1 ||
        details.recurring?.usage_type !== 'licensed' || details.billing_scheme !== 'per_unit') throw new Error('Stripe price mismatch');
    let mapping = this.db.prepare('SELECT stripe_customer_id FROM stripe_customer_accounts WHERE account_id=?').get(account.id);
    if (!mapping) {
      const customer = await this.stripe('customers', new URLSearchParams({email: account.email, 'metadata[launchpadre_account]': account.id}), 'launchpadre-customer-' + account.id);
      if (typeof customer.id !== 'string' || !customer.id.startsWith('cus_')) throw new Error('Invalid Stripe customer');
      this.db.prepare('INSERT INTO stripe_customer_accounts VALUES (?,?) ON CONFLICT(account_id) DO NOTHING').run(account.id, customer.id);
      mapping = this.db.prepare('SELECT stripe_customer_id FROM stripe_customer_accounts WHERE account_id=?').get(account.id);
    }
    const customer = String(mapping!.stripe_customer_id);
    const subscriptions = await this.subscriptions(customer);
    if (subscriptions.some(s => !['canceled','incomplete_expired'].includes(s.status))) throw new Error('Manage the existing subscription in Stripe');
    const session = await this.stripe('checkout/sessions', new URLSearchParams({
      mode: 'subscription', customer, client_reference_id: account.id, 'line_items[0][price]': price, 'line_items[0][quantity]': '1',
      success_url: origin.origin + '/?checkout=success', cancel_url: origin.origin + '/?checkout=canceled',
    }), 'launchpadre-checkout-' + account.id + '-' + price + '-' + Math.floor(Date.now() / 3600000));
    if (typeof session.url !== 'string' || new URL(session.url).origin !== 'https://checkout.stripe.com') throw new Error('Invalid checkout URL');
    return { url: session.url };
  }

  private async subscriptions(customer: string) {
    const items: any[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({customer, status: 'all', limit: '100'});
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
    if (event?.livemode !== false) return 400;
    if (!['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) return 200;
    const customer = event.data?.object?.customer;
    if (typeof customer !== 'string') return 400;
    const owner = this.db.prepare('SELECT account_id FROM stripe_customer_accounts WHERE stripe_customer_id=?').get(customer);
    if (!owner) return 200;
    const subscriptions = await this.subscriptions(customer);
    const activePrices = new Set(subscriptions.filter(s => s.livemode === false && s.customer === customer && ['active','trialing'].includes(s.status))
      .flatMap(s => s.items?.data?.map((item: any) => item.price?.id) || []));
    const matching = this.prices.filter(p => p.id && activePrices.has(p.id));
    const plan = matching.some(p => p.plan === 'academic_tier') ? 'academic_tier' : matching.length ? 'indie_solo' : 'free';
    this.db.prepare('UPDATE customer_accounts SET plan=? WHERE id=?').run(plan, owner.account_id);
    return 200;
  }
}
