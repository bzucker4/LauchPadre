import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import CustomerWorkspace, { type CustomerProfile } from './CustomerWorkspace.tsx';

export default function App() {
  const [ready, setReady] = useState(false);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch('/api/customer/me');
      if (response.ok) {
        setCustomer(await response.json());
      } else {
        setCustomer(null);
      }
    } catch {
      setError('Server unavailable. Check your connection and try again.');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const checkout = new URLSearchParams(window.location.search).get('checkout');
  const checkoutNotice =
    checkout === 'success'
      ? 'You returned from Stripe. Sign in with the account that started checkout to check your subscription.'
      : checkout === 'canceled'
        ? 'Checkout was canceled. Sign in to return to your workspace.'
        : '';

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070b19] px-4 text-slate-300">
        <p className="text-sm">Connecting to LaunchPadre…</p>
      </main>
    );
  }

  if (customer) {
    return (
      <CustomerWorkspace
        customer={customer}
        checkoutReturn={checkout}
        onLogout={() => {
          setCustomer(null);
          setSessionNotice('');
        }}
        onSessionExpired={() => {
          setCustomer(null);
          setSessionNotice('Your session expired. Sign in again to continue.');
        }}
      />
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSessionNotice('');
    setBusy(true);
    try {
      const body = JSON.stringify({ email, password });
      const headers = { 'Content-Type': 'application/json' };
      if (register) {
        const created = await fetch('/api/customer/register', { method: 'POST', headers, body });
        const createdData = await created.json().catch(() => ({}));
        if (!created.ok) throw new Error(createdData.error || 'Registration failed');
      }
      const response = await fetch('/api/customer/login', { method: 'POST', headers, body });
      const loginData = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(loginData.error || 'Invalid credentials');
      const me = await fetch('/api/customer/me');
      if (!me.ok) throw new Error('Could not establish session. Ensure cookies are enabled.');
      setPassword('');
      setCustomer(await me.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#070b19] px-4 py-12 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="h-3 w-3 rounded-sm bg-amber-400" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">LaunchPadre</h1>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          {register
            ? 'Create an isolated customer workspace with guarded Git checkpoints and task tracking.'
            : 'Sign in to access your isolated repositories, checkpoints, and tasks.'}
        </p>

        {checkoutNotice && (
          <p role="status" className="mt-4 rounded-lg border border-blue-900 bg-blue-950/60 p-3 text-sm text-blue-200">
            {checkoutNotice}
          </p>
        )}
        {sessionNotice && (
          <p role="status" className="mt-4 rounded-lg border border-amber-800/80 bg-amber-950/40 p-3 text-sm text-amber-200">
            {sessionNotice}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-900/80 bg-rose-950/40 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-300">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@domain.com"
              className="mt-1.5 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-amber-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-300">
            Password
            <input
              type="password"
              minLength={register ? 12 : 1}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={register ? 'new-password' : 'current-password'}
              placeholder={register ? 'At least 12 characters' : 'Enter your password'}
              className="mt-1.5 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-amber-400"
            />
            {register && (
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Use 12 or more characters. Passwords are salted and hashed with scrypt.
              </span>
            )}
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer"
          >
            {busy ? (register ? 'Creating account…' : 'Signing in…') : register ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 border-t border-slate-800 pt-4 text-center">
          <button
            type="button"
            className="text-sm font-medium text-slate-300 hover:text-amber-300 cursor-pointer"
            onClick={() => {
              setRegister((v) => !v);
              setError('');
              setSessionNotice('');
            }}
          >
            {register ? 'Already have an account? Sign in' : 'Need an account? Create one'}
          </button>
        </div>
      </div>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        Protected by LaunchPadre 3-layer AI-scraper data sovereignty
      </p>
    </main>
  );
}
