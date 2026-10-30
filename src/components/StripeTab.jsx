import React, { useState } from 'react';

export const StripeTab = React.memo(function StripeTab({
  currentUser,
  onUserPlanUpdated,
}) {
  const [checkoutData, setCheckoutData] = useState(null);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [error, setError] = useState('');

  const handleCheckout = async (planId) => {
    if (!currentUser) return;
    setError(''); setIsCreatingCheckout(true);
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
      if (res.ok) setCheckoutData(data); else setError(data.error || 'Checkout failed');
    } catch { setError('Unable to connect'); } finally {
      setIsCreatingCheckout(false);
    }
  };

  return (
    <section className="space-y-6">
      <p className="text-sm text-slate-400">Checkout requires configured Stripe prices. Final prices appear on Stripe. Returning from checkout does not confirm payment; your plan updates after a verified webhook.</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
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
            Stripe price <span className="text-xs font-normal text-slate-400">/mo</span>
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
            Stripe price <span className="text-xs font-normal text-slate-400">/mo</span>
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
          <div className="text-amber-300 font-semibold">Stripe Checkout Session: {checkoutData.session_id}</div>
          <a className="text-amber-300 underline" href={checkoutData.checkout_url}>Continue to Stripe Checkout</a>
        </div>
      )}

    </section>
  );
});

