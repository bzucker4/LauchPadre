import React, { useState } from 'react';

export function RepositoryRegistration({ onRegistered }) {
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <details className="rounded border border-slate-700 p-4">
    <summary className="cursor-pointer font-semibold">Register a local Git repository</summary>
    <p className="my-3 text-sm text-slate-400">Enter a repository folder relative to your configured Git root. The repository must already exist on the server. Register only repositories and Git configurations you trust.</p>
    <form className="flex flex-wrap gap-3" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try {
        const response = await fetch('/api/v1/repositories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ local_path: localPath.trim() }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Registration failed');
        setLocalPath(''); await onRegistered(result);
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to connect'); }
      finally { setBusy(false); }
    }}>
      <label className="flex-1 text-sm">Repository folder
        <input required value={localPath} onChange={event => setLocalPath(event.target.value)} placeholder="my-project" className="mt-1 block w-full rounded bg-slate-900 border border-slate-600 p-2" />
      </label>
      <button disabled={busy} className="self-end rounded bg-amber-400 text-slate-950 px-4 py-2 font-semibold disabled:opacity-50">{busy ? 'Registering…' : 'Register'}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
  </details>;
}
