import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { DataPanel } from './CustomerWorkspace.tsx';

/** Shown instead of the workspace until the customer accepts the currently published Terms and Privacy Policy. */
export default function TermsGate({
  email,
  onAccepted,
  onLogout,
  onUnauthorized,
  onDeleted,
}: {
  email: string;
  onAccepted: () => void;
  onLogout: () => void;
  onUnauthorized: () => void;
  onDeleted: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/customer/accept-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_terms: agreed }),
      });
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not record your acceptance');
      onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your acceptance');
    } finally {
      setBusy(false);
    }
  }

  const link = 'text-amber-300 underline hover:text-amber-200';
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#070b19] px-4 py-12 text-slate-100">
      <div className="w-full max-w-lg space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl sm:p-8">
          <div className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-sm bg-amber-400" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight">We updated our terms</h1>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            Signed in as <strong>{email}</strong>. Please review our{' '}
            <a href="/terms" target="_blank" rel="noopener" className={link}>
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy" target="_blank" rel="noopener" className={link}>
              Privacy Policy
            </a>{' '}
            and accept them to keep using LaunchPadre. Your data is not affected until you decide.
          </p>
          {error && (
            <p role="alert" className="mt-4 rounded-lg border border-rose-900/80 bg-rose-950/40 p-3 text-sm text-rose-200">
              {error}
            </p>
          )}
          <form onSubmit={accept} className="mt-5 space-y-4">
            <label className="flex items-start gap-2.5 text-sm text-slate-300">
              <input
                type="checkbox"
                required
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-400"
              />
              <span>I have read and agree to the Terms of Service and Privacy Policy.</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy || !agreed}
                className="rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer"
              >
                {busy ? 'Saving…' : 'Accept and continue'}
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="text-sm font-medium text-slate-300 hover:text-amber-300 cursor-pointer"
              >
                Sign out
              </button>
            </div>
          </form>
        </div>
        <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <summary className="cursor-pointer font-medium">Don't agree? Take your data or delete your account</summary>
          <div className="mt-4">
            <DataPanel onUnauthorized={onUnauthorized} onDeleted={onDeleted} />
          </div>
        </details>
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
          Protected by LaunchPadre 3-layer AI-scraper data sovereignty
        </p>
      </div>
    </main>
  );
}
