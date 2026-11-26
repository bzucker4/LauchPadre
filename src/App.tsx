import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import CustomerWorkspace, { type CustomerProfile } from './CustomerWorkspace.tsx';

export default function App() {
  const [ready, setReady] = useState(false);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [mode, setMode] = useState<'signin' | 'register' | 'forgot' | 'reset'>('signin');
  const register = mode === 'register';
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
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

  // Emailed links land on /?verify=<token> or /?reset=<token>. Strip the token from the URL
  // right away, then act on it with a POST so link scanners cannot consume it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verify = params.get('verify');
    const reset = params.get('reset');
    if (!verify && !reset) return;
    params.delete('verify');
    params.delete('reset');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
    if (reset) {
      setResetToken(reset);
      setMode('reset');
      return;
    }
    void (async () => {
      try {
        const response = await fetch('/api/customer/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: verify }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) setSessionNotice('Email verified. Sign in to continue.');
        else setError(data.error || 'Verification failed');
      } catch {
        setError('Server unavailable. Check your connection and try again.');
      }
    })();
  }, []);

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
        onAccountDeleted={() => {
          setCustomer(null);
          setMode('signin');
          setSessionNotice('Your account and data were deleted. A confirmation email is on its way.');
        }}
        onSessionExpired={() => {
          setCustomer(null);
          setSessionNotice('Your session expired. Sign in again to continue.');
        }}
      />
    );
  }

  async function post(path: string, payload: unknown) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function switchMode(next: typeof mode) {
    setMode(next);
    setError('');
    setSessionNotice('');
    setNeedsVerification(false);
  }

  async function resendVerification() {
    setError('');
    setBusy(true);
    try {
      const { response, data } = await post('/api/customer/resend-verification', { email });
      if (!response.ok) throw new Error(data.error || 'Could not send email');
      setNeedsVerification(false);
      setSessionNotice('If that account needs verification, a new link is on its way.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send email');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSessionNotice('');
    setNeedsVerification(false);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const { response, data } = await post('/api/customer/forgot-password', { email });
        if (!response.ok) throw new Error(data.error || 'Could not send email');
        setSessionNotice('If an account exists for that email, a reset link is on its way. It expires in 1 hour.');
        return;
      }
      if (mode === 'reset') {
        const { response, data } = await post('/api/customer/reset-password', { token: resetToken, password });
        if (!response.ok) throw new Error(data.error || 'Reset failed');
        setPassword('');
        setResetToken('');
        setMode('signin');
        setSessionNotice('Password updated. Sign in with your new password.');
        return;
      }
      if (register) {
        const { response, data } = await post('/api/customer/register', { email, password, accepted_terms: acceptedTerms });
        if (!response.ok) throw new Error(data.error || 'Registration failed');
        setPassword('');
        setMode('signin');
        setSessionNotice(`We sent a verification link to ${email}. Verify your email, then sign in.`);
        return;
      }
      const { response, data } = await post('/api/customer/login', { email, password });
      if (!response.ok) {
        if (data.code === 'email_unverified') setNeedsVerification(true);
        throw new Error(data.error || 'Invalid credentials');
      }
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
          {mode === 'register'
            ? 'Create an isolated customer workspace with guarded Git checkpoints and task tracking.'
            : mode === 'forgot'
              ? 'Enter your account email and we will send a password reset link.'
              : mode === 'reset'
                ? 'Choose a new password for your account.'
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

        {needsVerification && (
          <button
            type="button"
            disabled={busy}
            onClick={resendVerification}
            className="mt-3 text-sm font-medium text-amber-300 hover:text-amber-200 disabled:opacity-50 cursor-pointer"
          >
            Resend verification email
          </button>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode !== 'reset' && (
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
          )}
          {mode !== 'forgot' && (
          <label className="block text-sm font-medium text-slate-300">
            {mode === 'reset' ? 'New password' : 'Password'}
            <input
              type="password"
              minLength={register || mode === 'reset' ? 12 : 1}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={register || mode === 'reset' ? 'new-password' : 'current-password'}
              placeholder={register || mode === 'reset' ? 'At least 12 characters' : 'Enter your password'}
              className="mt-1.5 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-amber-400"
            />
            {(register || mode === 'reset') && (
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Use 12 or more characters. Passwords are salted and hashed with scrypt.
              </span>
            )}
          </label>
          )}
          {register && (
            <label className="flex items-start gap-2.5 text-sm text-slate-300">
              <input
                type="checkbox"
                required
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-400"
              />
              <span>
                I agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener" className="text-amber-300 underline hover:text-amber-200">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" rel="noopener" className="text-amber-300 underline hover:text-amber-200">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer"
          >
            {busy
              ? 'Working…'
              : mode === 'register'
                ? 'Create account'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : mode === 'reset'
                    ? 'Set new password'
                    : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 space-y-2 border-t border-slate-800 pt-4 text-center">
          {mode === 'signin' && (
            <button
              type="button"
              className="block w-full text-sm font-medium text-slate-300 hover:text-amber-300 cursor-pointer"
              onClick={() => switchMode('forgot')}
            >
              Forgot your password?
            </button>
          )}
          <button
            type="button"
            className="block w-full text-sm font-medium text-slate-300 hover:text-amber-300 cursor-pointer"
            onClick={() => switchMode(mode === 'signin' ? 'register' : 'signin')}
          >
            {mode === 'signin' ? 'Need an account? Create one' : mode === 'register' ? 'Already have an account? Sign in' : 'Back to sign in'}
          </button>
        </div>
      </div>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        Protected by LaunchPadre 3-layer AI-scraper data sovereignty
      </p>
      <p className="mt-2 flex gap-4 text-xs text-slate-500">
        <a href="/terms" className="hover:text-amber-300">Terms</a>
        <a href="/privacy" className="hover:text-amber-300">Privacy</a>
      </p>
    </main>
  );
}
