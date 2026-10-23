import React, { useState } from 'react';

export const StripeTab = React.memo(function StripeTab({
  currentUser,
  onUserPlanUpdated,
}) {
  const [checkoutData, setCheckoutData] = useState(null);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [webhookOutcome, setWebhookOutcome] = useState(null);

  const handleCheckout = async (planId) => {
    if (!currentUser) return;
    setIsCreatingCheckout(true);
    try {
      const res = await fetch('/api/v1/billing/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          plan_id: planId,
        }),
      });
      const data = await res.json();
      if (res.ok) setCheckoutData(data);
    } finally {
      setIsCreatingCheckout(false);
    }
  };

  const handleSimulateWebhook = async (eventType) => {
    if (!currentUser) return;
    const res = await fetch('/api/v1/billing/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1600000000,v1=simulated_hex',
      },
      body: JSON.stringify({
        type: eventType,
        data: {
          object: {
            client_reference_id: String(currentUser.id),
            customer: currentUser.stripe_customer_id || `cus_${currentUser.username}`,
            subscription: `sub_stripe_${Date.now().toString().slice(-6)}`,
            metadata: { plan_id: 'academic_tier' },
          },
        },
      }),
    });
    const data = await res.json();
    setWebhookOutcome(data);
    onUserPlanUpdated();
  };

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div
          className={`p-5 bg-[#0b132b] border rounded-lg space-y-3 ${
            currentUser?.plan === 'free' ? 'border-amber-400' : 'border-slate-800'
          }`}
        >
          <div className="text-xs font-mono text-slate-400">Tier 01</div>
          <h3 className="text-base font-bold text-slate-100 font-display">Free Developer</h3>
          <div className="text-xl font-bold font-mono">
            $0 <span className="text-xs font-normal text-slate-400">/mo</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-1.5">
            <li>✓ 3 Repositories</li>
            <li>✓ 1 Panic Snapshot</li>
          </ul>
        </div>

        <div
          className={`p-5 bg-[#0b132b] border rounded-lg space-y-3 ${
            currentUser?.plan === 'indie_solo' ? 'border-amber-400 ring-1 ring-amber-400' : 'border-slate-800'
          }`}
        >
          <div className="text-xs font-mono text-amber-300">Tier 02 · Recommended</div>
          <h3 className="text-base font-bold text-slate-100 font-display">Indie Solo</h3>
          <div className="text-xl font-bold font-mono">
            $12 <span className="text-xs font-normal text-slate-400">/mo</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-1.5">
            <li>✓ Unlimited Repositories</li>
            <li>✓ Panic Room Hard Reset Engine</li>
            <li>✓ Filesystem Slop Sweep (git clean -fd)</li>
          </ul>
          <button
            type="button"
            onClick={() => handleCheckout('indie_solo')}
            disabled={isCreatingCheckout}
            className="w-full py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded cursor-pointer"
          >
            Subscribe to Indie Solo
          </button>
        </div>

        <div
          className={`p-5 bg-[#0b132b] border rounded-lg space-y-3 ${
            currentUser?.plan === 'academic_tier' ? 'border-amber-400 ring-1 ring-amber-400' : 'border-slate-800'
          }`}
        >
          <div className="text-xs font-mono text-amber-300">Tier 03 · Institutions</div>
          <h3 className="text-base font-bold text-slate-100 font-display">Academic Researcher</h3>
          <div className="text-xl font-bold font-mono">
            $29 <span className="text-xs font-normal text-slate-400">/mo</span>
          </div>
          <ul className="text-xs text-slate-300 space-y-1.5">
            <li>✓ All Indie Solo features</li>
            <li>✓ Automated Zenodo DOI Minting</li>
            <li>✓ Permanent Citation Badges</li>
          </ul>
          <button
            type="button"
            onClick={() => handleCheckout('academic_tier')}
            disabled={isCreatingCheckout}
            className="w-full py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded cursor-pointer"
          >
            Subscribe to Academic
          </button>
        </div>
      </div>

      {checkoutData && (
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono space-y-1">
          <div className="text-amber-300 font-semibold">Created Checkout Session: {checkoutData.session_id}</div>
          <div className="text-slate-400">URL: {checkoutData.checkout_url}</div>
        </div>
      )}

      {/* Simulated Webhook Controls */}
      <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-slate-100 font-display">
          Stripe Webhook Lifecycle Simulator
        </h3>
        <p className="text-xs text-slate-400">
          Trigger simulated Stripe webhook payloads to test asynchronous user upgrades and downgrades via <code className="font-mono text-slate-200">POST /api/v1/billing/webhooks/stripe</code>.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => handleSimulateWebhook('checkout.session.completed')}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-950/60 border border-emerald-700 text-emerald-200 hover:bg-emerald-900/80 rounded transition-colors cursor-pointer"
          >
            Simulate checkout.session.completed
          </button>
          <button
            type="button"
            onClick={() => handleSimulateWebhook('customer.subscription.deleted')}
            className="px-3 py-1.5 text-xs font-medium bg-rose-950/60 border border-rose-700 text-rose-200 hover:bg-rose-900/80 rounded transition-colors cursor-pointer"
          >
            Simulate customer.subscription.deleted
          </button>
        </div>
        {webhookOutcome && (
          <div className="p-3 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-slate-300">
            Webhook Processed: {JSON.stringify(webhookOutcome)}
          </div>
        )}
      </div>
    </section>
  );
});
