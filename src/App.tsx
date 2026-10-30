import React, { useEffect, useState } from 'react';
import LaunchPadreDashboard from './LaunchPadreDashboard.jsx';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [required, setRequired] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session').then(r => {
      if (!r.ok) throw new Error('Unable to check session');
      return r.json();
    }).then(s => { setAuthenticated(s.authenticated); setRequired(s.required); })
      .catch(() => setError('Unable to connect. Reload to try again.'))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <p className="p-8">Loading workspace…</p>;
  if (authenticated) return <>
    {required && <button className="fixed bottom-4 right-4 z-50 bg-slate-800 px-4 py-2 rounded" onClick={async () => {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok) throw new Error();
        setAuthenticated(false);
      } catch { setError('Sign out failed. Try again.'); }
    }}>Sign out</button>}
    {error && <p role="alert" className="p-4 text-red-300">{error}</p>}
    <LaunchPadreDashboard />
  </>;
  return <main className="min-h-screen grid place-items-center p-6">
    <form className="w-full max-w-sm space-y-5" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Sign in failed');
        setPassword(''); setAuthenticated(true); setRequired(true);
      } catch (err) { setError(err instanceof Error ? err.message : 'Sign in failed'); }
      finally { setBusy(false); }
    }}>
      <h1 className="text-3xl font-bold">LaunchPadre</h1>
      <p>Sign in to your private workspace.</p>
      <label className="block">Workspace password
        <input className="block w-full mt-2 rounded border border-slate-600 bg-slate-900 p-3" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <button disabled={busy} className="rounded bg-amber-400 text-slate-950 px-5 py-3 font-bold disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </main>;
}

