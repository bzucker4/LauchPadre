import { useEffect, useState } from 'react';

export default function AccountAccess() {
  const [account, setAccount] = useState<{ email: string; email_verified_at: string | null }>();
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([fetch('/api/customer/me'), fetch('/api/customer/auth-options')])
      .then(async ([identity, options]) => {
        if (!identity.ok || !options.ok) throw new Error('Could not load account details');
        const [customer, settings] = await Promise.all([identity.json(), options.json()]);
        if (active) { setAccount(customer); setEmailEnabled(settings.email_enabled); }
      }).catch(() => { if (active) setError('Could not load account details'); });
    return () => { active = false; };
  }, []);
  async function verify() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/customer/request-verification', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not request verification');
      setMessage(result.message);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not request verification'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6" aria-labelledby="account-title">
    <h2 id="account-title" className="text-xl font-semibold">Account</h2>
    {account && <>
      <p className="mt-2 break-all text-sm text-slate-300">{account.email}</p>
      <p className="mt-2 text-sm text-slate-300">{account.email_verified_at ? 'Email verified' : 'Email verification pending'}</p>
      {!account.email_verified_at && emailEnabled && <button className="mt-3 rounded-lg border border-slate-600 px-4 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50" disabled={busy} onClick={() => void verify()}>Send verification email</button>}
      {!account.email_verified_at && !emailEnabled && <p className="mt-2 text-sm text-slate-400">Your workspace operator needs to configure email delivery.</p>}
    </>}
    {message && <p className="mt-3 text-sm text-emerald-300" role="status">{message}</p>}
    {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}
  </section>;
}
