import React, { useEffect, useState } from 'react';
import CustomerWorkspace from './CustomerWorkspace';
import SupportLinks from './SupportLinks';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
const field = 'mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-3 text-slate-100 focus-visible:outline-2 focus-visible:outline-amber-400';
const button = 'rounded-lg bg-amber-400 px-4 py-3 font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50';

export default function App() {
  const [action, setAction] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const [mode, setMode] = useState<Mode>(() => action.get('action') === 'reset' ? 'reset' : action.get('action') === 'verify' ? 'verify' : 'login');
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const handleAction = () => {
      const next = new URLSearchParams(window.location.hash.slice(1));
      const requested = next.get('action');
      if (requested !== 'reset' && requested !== 'verify') return;
      setAction(next); setMode(requested); setError(''); setMessage('');
      setPassword(''); setPasswordConfirmation('');
    };
    window.addEventListener('hashchange', handleAction);
    return () => window.removeEventListener('hashchange', handleAction);
  }, []);
  useEffect(() => {
    let active = true;
    fetch('/api/customer/me').then(response => { if (active) setLoggedIn(response.ok); })
      .catch(() => { if (active) setError('Server unavailable'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  const checkout = new URLSearchParams(window.location.search).get('checkout');
  if (!ready) return <main className="p-12" role="status">Connecting…</main>;
  if (loggedIn && mode !== 'reset' && mode !== 'verify') {
    return <><CustomerWorkspace checkoutReturn={checkout} onLogout={() => { setLoggedIn(false); setMode('login'); }} /><SupportLinks /></>;
  }
  function switchMode(next: Mode) { setMode(next); setError(''); setMessage(''); setPassword(''); setPasswordConfirmation(''); }
  async function post(route: string, data: unknown) {
    const response = await fetch('/api/customer/' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
    return result;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      if (mode === 'reset' && password !== passwordConfirmation) throw new Error('The passwords must match');
      if (mode === 'forgot') {
        const result = await post('request-reset', { email }); setMessage(result.message);
      } else if (mode === 'reset') {
        const result = await post('reset-password', { token: action.get('token'), password });
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setPassword(''); setPasswordConfirmation(''); setLoggedIn(false); setMode('login'); setMessage(result.message);
      } else if (mode === 'verify') {
        const result = await post('verify-email', { token: action.get('token') });
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setMessage(result.message);
      } else {
        if (mode === 'register') await post('register', { email, password });
        await post('login', { email, password }); setPassword(''); setLoggedIn(true);
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to complete request'); }
    finally { setBusy(false); }
  }
  const titles: Record<Mode, string> = {
    login: 'Sign in to your workspace', register: 'Create your customer account',
    forgot: 'Request a password reset', reset: 'Choose a new password', verify: 'Verify your email address',
  };
  const labels: Record<Mode, string> = {
    login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Reset password', verify: 'Verify email',
  };
  return <main className="mx-auto my-12 max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 sm:my-24 sm:p-8">
    <h1 className="text-3xl font-bold">LauchPadre</h1>
    <p className="mt-3 text-slate-300">{titles[mode]}</p>
    {checkout === 'success' && mode === 'login' && <p className="mt-4 text-sm text-blue-200" role="status">You returned from Stripe. Sign in with the account that started checkout to check your subscription.</p>}
    {checkout === 'canceled' && mode === 'login' && <p className="mt-4 text-sm text-blue-200" role="status">Checkout was canceled. Sign in to return to your workspace.</p>}
    <form onSubmit={submit} className="mt-6 space-y-4">
      {['login', 'register', 'forgot'].includes(mode) && <label className="block text-sm">Email
        <input className={field} type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" />
      </label>}
      {['login', 'register', 'reset'].includes(mode) && <label className="block text-sm">{mode === 'reset' ? 'New password' : 'Password'}
        <input className={field} type="password" minLength={mode === 'login' ? 1 : 12} maxLength={1024} required value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      </label>}
      {mode === 'reset' && <label className="block text-sm">Confirm new password
        <input className={field} type="password" minLength={12} maxLength={1024} required value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} autoComplete="new-password" />
      </label>}
      {mode !== 'verify' || !message ? <button className={button} disabled={busy}>{busy ? 'Please wait…' : labels[mode]}</button> : null}
    </form>
    {message && <p className="mt-4 text-emerald-300" role="status">{message}</p>}
    {error && <p className="mt-4 text-red-300" role="alert">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-4 text-sm">
      {mode === 'login' && <>
        <button onClick={() => switchMode('register')} className="underline focus-visible:outline-2 focus-visible:outline-amber-400">Create an account</button>
        <button onClick={() => switchMode('forgot')} className="underline focus-visible:outline-2 focus-visible:outline-amber-400">Forgot password?</button>
      </>}
      {mode !== 'login' && <button className="underline focus-visible:outline-2 focus-visible:outline-amber-400" onClick={() => {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        switchMode('login');
      }}>{loggedIn ? 'Return to workspace' : 'Return to sign in'}</button>}
    </div>
    <SupportLinks />
  </main>;
}
