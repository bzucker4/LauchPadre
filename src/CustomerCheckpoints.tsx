import React, { useEffect, useState } from 'react';

type Snapshot = { tag: string; head: string; created_at: string };
type GitInfo = {
  enabled: boolean; customer_directory: string; relative_path: string | null;
  head?: string; branch?: string; unborn?: boolean; snapshots: Snapshot[];
};
const field = 'mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100 focus-visible:outline-2 focus-visible:outline-amber-400';
const button = 'rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50';

export default function CustomerCheckpoints({ repositoryId }: { repositoryId: string }) {
  const [info, setInfo] = useState<GitInfo>();
  const [relative, setRelative] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<Snapshot>();
  async function request(suffix: string, method = 'GET', body?: unknown) {
    const response = await fetch(`/api/customer/repositories/${repositoryId}/${suffix}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load Git checkpoints');
    return result;
  }
  useEffect(() => {
    let active = true;
    request('checkpoints').then(result => { if (active) setInfo(result); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [repositoryId]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setInfo(await request('checkpoints')); }
    catch (error) { setError(error instanceof Error ? error.message : 'Git operation failed'); }
    finally { setBusy(false); }
  }
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6" aria-labelledby="checkpoints-title">
      <h2 id="checkpoints-title" className="text-xl font-semibold">Git checkpoints</h2>
      <p className="mt-2 text-sm text-slate-300">Checkpoints preserve committed work. Commit your changes before creating one.</p>
      {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
      {message && <p role="status" className="mt-3 break-all text-emerald-300">{message}</p>}
      {!info && !error && <p role="status" className="mt-3">Loading checkpoints…</p>}
      {info && !info.enabled && <p className="mt-3 text-sm text-slate-300">The workspace operator needs to enable Git checkpoints.</p>}
      {info?.enabled && !info.relative_path && (
        <form className="mt-4 space-y-3" onSubmit={event => {
          event.preventDefault(); void act(() => request('git', 'PUT', { relative_path: relative }));
        }}>
          <p className="text-sm text-slate-300 break-all">Ask the workspace operator to place your repository inside customer directory <code>{info.customer_directory}</code>.</p>
          <label className="block text-sm">Repository path within your customer directory
            <input className={field} value={relative} onChange={event => setRelative(event.target.value)} placeholder="my-project" required maxLength={500} />
          </label>
          <button className={button} disabled={busy}>Connect Git repository</button>
        </form>
      )}
      {info?.relative_path && <>
        <p className="mt-3 break-all text-sm text-slate-300">{info.relative_path} · {info.branch} · {info.head?.slice(0, 12) || 'Initial commit needed'}</p>
        <form className="mt-4 space-y-3" onSubmit={event => {
          event.preventDefault(); void act(async () => {
            await request('checkpoints', 'POST', { name }); setName(''); setMessage('Checkpoint saved.');
          });
        }}>
          <label className="block text-sm">Checkpoint name
            <input className={field} value={name} onChange={event => setName(event.target.value)} required maxLength={64} pattern="[a-z0-9_-]+" placeholder="before-release" />
          </label>
          <p className="text-sm text-slate-400">Use lowercase letters, numbers, underscores or hyphens.</p>
          <button className={button} disabled={busy || info.unborn}>Create checkpoint</button>
          <button type="button" className={button + ' ml-3'} disabled={busy} onClick={() => void act(async () => {})}>Refresh Git state</button>
        </form>
        <ul className="mt-4 divide-y divide-slate-700">
          {info.snapshots.map(snapshot => <li key={snapshot.tag} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0"><p className="break-all">{snapshot.tag.replace('panic_room_launchpadre_', '')}</p>
              <p className="text-sm text-slate-400">{snapshot.head.slice(0, 12)}</p></div>
            <button type="button" className={button} disabled={busy} onClick={() => setRestore(snapshot)}>Restore</button>
          </li>)}
        </ul>
        {!info.snapshots.length && <p className="mt-3 text-sm text-slate-400">No checkpoints yet.</p>}
        {restore && <div className="mt-4 rounded-lg border border-amber-500 p-4" role="group" aria-label="Confirm checkpoint restore">
          <p className="break-words">Restore {restore.tag.replace('panic_room_launchpadre_', '')}? This resets the connected repository to {restore.head.slice(0, 12)}. Your current commit will be preserved in a recovery ref. All tracked, untracked and ignored files must be clean.</p>
          <div className="mt-3 flex gap-3">
            <button className={button} disabled={busy} onClick={() => void act(async () => {
              const result = await request('restore', 'POST', { tag: restore.tag, expected_head: info.head, expected_target: restore.head });
              setRestore(undefined); setMessage(`Restored checkpoint. Previous commit preserved at ${result.recoveryRef}`);
            })}>Confirm restore</button>
            <button className={button} disabled={busy} onClick={() => setRestore(undefined)}>Cancel</button>
          </div>
        </div>}
      </>}
    </section>
  );
}
