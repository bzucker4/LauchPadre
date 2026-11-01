import { PLANS, type BillingInterval } from './plans.ts';

export class StripeClient {
  constructor(private secret: string, private origin: string, private prices: Record<string, string>, private request: typeof fetch = fetch) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Stripe return origin must use HTTPS');
    if (url.origin !== origin) throw new Error('APP_ORIGIN must be an origin without a path');
  }
  private async call(route: string, options: RequestInit = {}) {
    const response = await this.request(`https://api.stripe.com/v1/${route}`, {
      ...options, headers: { ...options.headers, Authorization: `Bearer ${this.secret}` }, signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    const result = await response.json();
    if (!response.ok) throw new Error('Stripe request failed. Check server configuration and Stripe logs.');
    return result;
  }
  priceId(plan: string, interval: BillingInterval): string | undefined {
    return this.prices[`${plan}_${interval}`] || (interval === 'month' ? this.prices[plan] : undefined);
  }
  async checkout(user: { id: number; email: string; stripe_customer_id: string | null }, plan: string, interval: BillingInterval = 'month') {
    if (plan !== 'indie_solo' && plan !== 'academic_tier') throw new Error('Invalid paid plan');
    if (interval !== 'month' && interval !== 'year') throw new Error('Invalid billing interval');
    const price = this.priceId(plan, interval);
    if (!price || !/^price_[A-Za-z0-9]+$/.test(price)) throw new Error('Stripe price is not configured for this plan');
    const expected = interval === 'month' ? PLANS[plan].monthly : PLANS[plan].annual;
    const configured = await this.call(`prices/${price}`);
    if (configured.active !== true || configured.currency !== 'usd' || configured.unit_amount !== expected ||
        configured.recurring?.interval !== interval || configured.recurring?.interval_count !== 1 ||
        configured.recurring?.usage_type !== 'licensed' || configured.billing_scheme !== 'per_unit') {
      throw new Error('Configured Stripe price must match the advertised USD amount and billing interval. No checkout was created.');
    }
    const body = new URLSearchParams({
      mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1',
      client_reference_id: String(user.id), 'metadata[plan_id]': plan,
      'subscription_data[metadata][plan_id]': plan, 'subscription_data[metadata][user_id]': String(user.id),
      'subscription_data[metadata][billing_interval]': interval,
      success_url: `${this.origin}/?checkout=success`, cancel_url: `${this.origin}/?checkout=cancelled`,
    });
    if (user.stripe_customer_id) body.set('customer', user.stripe_customer_id);
    else body.set('customer_email', user.email);
    const result = await this.call('checkout/sessions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (typeof result.id !== 'string' || typeof result.url !== 'string' || new URL(result.url).origin !== 'https://checkout.stripe.com') throw new Error('Unexpected Stripe checkout response');
    return { session_id: result.id, checkout_url: result.url, mode: 'live', plan_id: plan, billing_interval: interval };
  }
  async subscription(id: string) {
    if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid subscription id');
    return this.call(`subscriptions/${id}`);
  }
}

