import React, { useCallback, useEffect, useState } from 'react';
import { PLANS } from '../plans.ts';
import { requestJson } from '../apiClient.ts';

const FEATURES = {
  free: ['3 registered local repositories', '1 checkpoint per repository', 'Guarded rollback and Kanban tasks'],
  indie_solo: ['Unlimited registered local repositories', 'Unlimited committed-HEAD checkpoints', 'Guarded rollback with recovery refs', 'Kanban tasks and Git webhook ingestion'],
  academic_tier: ['Everything in Indie Solo', 'Zenodo software archive drafts', 'Separate, confirmed publication', 'DOI links after successful publication'],
};

export const StripeTab = React.memo(function StripeTab({ currentUser, onUserPlanUpdated }) {
  const [interval, setInterval] = useState('month');
  const [availability, setAvailability] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [checkoutData, setCheckoutData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadAvailability = useCallback(async signal => {
    setLoaded(false); setError('');
    try {
      const result = await requestJson('/api/v1/billing/plans', { signal });
      if (!Array.isArray(result?.plans)) throw new Error('The running server returned an unsupported billing response. Restart LaunchPadre and reload.');
      if (!signal?.aborted) setAvailability(Object.fromEntries(result.plans.map(plan => [plan.id, plan])));
    } catch (failure) {
      if (!signal?.aborted) {
        setAvailability({});
        setError(failure instanceof Error ? failure.message : 'Unable to check payment availability. Run npm run doctor.');
      }
    } finally { if (!signal?.aborted) setLoaded(true); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadAvailability(controller.signal);
    return () => controller.abort();
  }, [loadAvailability]);
  const checkout = async plan => {
    if (!currentUser) return;
    setBusy(true); setError(''); setCheckoutData(null);
    try {
      const result = await requestJson('/api/v1/billing/checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUser.id, plan_id: plan, billing_interval: interval }),
      });
      setCheckoutData(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to connect'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-xl font-bold mr-3">Plans and pricing</h2>
      {['month', 'year'].map(value => <button key={value} type="button" aria-pressed={interval === value} disabled={busy} onClick={() => { setInterval(value); setCheckoutData(null); }}
        className={`rounded border px-4 py-2 ${interval === value ? 'border-amber-400 text-amber-300' : 'border-slate-700 text-slate-300'}`}>
        {value === 'month' ? 'Monthly' : 'Annual'}
      </button>)}
    </div>
    <p className="text-sm text-slate-400">USD. Annual plans are billed once per year. Checkpoints protect committed work; commit your changes before creating one. Zenodo requires your own account and token.</p>
    {error && <div role="alert" className="space-y-2 text-red-300"><p>{error}</p><button type="button" disabled={!loaded || busy} onClick={() => loadAvailability()} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Retry availability</button></div>}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {Object.entries(PLANS).map(([id, plan]) => {
        const cents = interval === 'month' ? plan.monthly : plan.annual;
        const active = currentUser?.plan === id;
        const configured = availability[id]?.[interval === 'month' ? 'monthly_checkout' : 'annual_checkout'];
        return <article key={id} className={`p-5 bg-[#0b132b] border rounded-lg space-y-4 ${active ? 'border-amber-400' : 'border-slate-800'}`}>
          <h3 className="text-lg font-bold">{plan.name}</h3>
          <div className="text-2xl font-bold font-mono">${cents / 100}<span className="text-sm font-normal text-slate-400">/{interval === 'month' ? 'month' : 'year'}</span></div>
          {id !== 'free' && interval === 'year' && <p className="text-sm text-amber-300">Save ${(plan.monthly * 12 - plan.annual) / 100} compared with 12 monthly payments.</p>}
          <ul className="space-y-2 text-sm text-slate-300">{FEATURES[id].map(feature => <li key={feature}>✓ {feature}</li>)}</ul>
          {id === 'free' ? <p className="text-sm text-amber-300">{active ? 'Current plan' : 'Free plan available after paid subscription ends'}</p> : <>
            <button type="button" onClick={() => checkout(id)} disabled={busy || !currentUser || !configured || Boolean(currentUser.stripe_subscription_id)}
              className="w-full rounded bg-amber-400 text-slate-950 px-4 py-2 font-semibold disabled:opacity-50">
              {currentUser?.stripe_subscription_id ? (active ? 'Current subscription' : 'Manage existing subscription first') : busy ? 'Preparing checkout…' : `Subscribe to ${plan.name}`}
            </button>
            {loaded && !error && !configured && <p className="text-sm text-slate-400">{interval === 'year' ? 'Annual' : 'Monthly'} payments are not configured. Local Git and tasks still work.</p>}
          </>}
        </article>;
      })}
    </div>
    <p className="text-sm text-slate-400">Your plan changes after a verified payment webhook. Existing subscriptions are managed in Stripe.</p>
    <button type="button" onClick={onUserPlanUpdated} className="rounded border border-slate-600 px-4 py-2 text-sm">Refresh subscription status</button>
    {checkoutData && <div className="p-4 rounded border border-slate-700">
      <a href={checkoutData.checkout_url} className="text-amber-300 underline">Continue to Stripe Checkout</a>
    </div>}
  </section>;
});
