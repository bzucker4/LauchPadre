import React, { useEffect, useState } from 'react';
import { Check, Copy, GitBranch, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { PLANS, type PlanId } from './plans.ts';

type Snapshot = { tag: string; head: string; created_at: string };
type GitInfo = {
  enabled: boolean;
  customer_directory: string;
  relative_path: string | null;
  head?: string;
  branch?: string;
  unborn?: boolean;
  snapshots: Snapshot[];
};

const field =
  'mt-2 min-w-0 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-amber-400';
const button =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer';
const primary =
  'inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer';

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function CustomerCheckpoints({
  repositoryId,
  plan,
  onUnauthorized,
  onGitConnected,
}: {
  repositoryId: string;
  plan: PlanId;
  onUnauthorized: () => void;
  onGitConnected?: (connected: boolean) => void;
}) {
  const [info, setInfo] = useState<GitInfo>();
  const [relative, setRelative] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recoveryRef, setRecoveryRef] = useState('');
  const [copiedRef, setCopiedRef] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<Snapshot>();

  async function request(suffix: string, method = 'GET', body?: unknown) {
    const response = await fetch(`/api/customer/repositories/${repositoryId}/${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) {
      onUnauthorized();
      throw new Error('Session expired');
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not load Git checkpoints');
    return result;
  }

  useEffect(() => {
    let active = true;
    setError('');
    setMessage('');
    setRecoveryRef('');
    setRestore(undefined);
    request('checkpoints')
      .then((result: GitInfo) => {
        if (active) {
          setInfo(result);
          onGitConnected?.(Boolean(result.relative_path));
        }
      })
      .catch((err) => {
        if (active && err.message !== 'Session expired') {
          setError(err.message);
          onGitConnected?.(false);
        }
      });
    return () => {
      active = false;
    };
  }, [repositoryId]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    setRecoveryRef('');
    try {
      await action();
      const updated: GitInfo = await request('checkpoints');
      setInfo(updated);
      onGitConnected?.(Boolean(updated.relative_path));
    } catch (err) {
      if (err instanceof Error && err.message !== 'Session expired') {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const limit = PLANS[plan].snapshotsPerRepository;
  const count = info?.snapshots.length ?? 0;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6" aria-labelledby="checkpoints-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 id="checkpoints-title" className="text-lg font-semibold text-slate-100">
              Git Checkpoints &amp; Guarded Restore
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Checkpoints tag committed HEAD without modifying files. Restore verifies a clean worktree and preserves your prior commit in a recovery ref.
          </p>
        </div>
        {info?.relative_path && (
          <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300 tabular-nums">
            {limit === null ? `${count} checkpoint${count === 1 ? '' : 's'} · Unlimited` : `${count} / ${limit} checkpoint on Free`}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-900/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      {message && (
        <div role="status" className="mt-3 rounded-lg border border-emerald-900/80 bg-emerald-950/40 px-3 py-2.5 text-sm text-emerald-200">
          <p className="break-words">{message}</p>
          {recoveryRef && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-slate-950/80 px-2 py-1 text-xs text-emerald-300 break-all">{recoveryRef}</code>
              <button
                type="button"
                className={button}
                onClick={() => {
                  void navigator.clipboard?.writeText(recoveryRef);
                  setCopiedRef(true);
                  setTimeout(() => setCopiedRef(false), 2000);
                }}
              >
                {copiedRef ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedRef ? 'Copied' : 'Copy ref'}
              </button>
            </div>
          )}
        </div>
      )}

      {!info && !error && <p role="status" className="mt-3 text-sm text-slate-400">Loading checkpoints…</p>}
      {info && !info.enabled && (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-400">
          The workspace operator needs to configure <code className="text-slate-200">LAUNCHPADRE_CUSTOMER_GIT_ROOT</code> to enable Git checkpoints.
        </p>
      )}

      {info?.enabled && !info.relative_path && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await request('git', 'PUT', { relative_path: relative });
              setRelative('');
              setMessage('Git repository connected.');
            });
          }}
        >
          <p className="text-sm text-slate-300 break-all">
            Ask the workspace operator to place your repository inside customer directory{' '}
            <code className="rounded bg-slate-950 px-1.5 py-0.5 text-amber-300">{info.customer_directory}</code>.
          </p>
          <label className="block text-sm text-slate-300">
            Repository path within your customer directory
            <input
              className={field}
              value={relative}
              onChange={(event) => setRelative(event.target.value)}
              placeholder="my-project"
              required
              maxLength={500}
            />
          </label>
          <button type="submit" className={primary} disabled={busy}>
            Connect Git repository
          </button>
        </form>
      )}

      {info?.relative_path && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2 font-mono text-slate-300">
              <GitBranch className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span className="break-all text-slate-100">{info.relative_path}</span>
              <span className="text-slate-600">/</span>
              <span className="rounded bg-slate-900 px-1.5 py-0.5 text-amber-300">{info.branch || 'HEAD'}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">{info.head ? info.head.slice(0, 12) : 'Initial commit needed'}</span>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-amber-300 cursor-pointer disabled:opacity-50"
              disabled={busy}
              onClick={() => void act(async () => {})}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh Git state
            </button>
          </div>

          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                await request('checkpoints', 'POST', { name });
                setName('');
                setMessage('Checkpoint saved.');
              });
            }}
          >
            <label className="min-w-0 flex-1 text-sm text-slate-300">
              Checkpoint name
              <input
                className={field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={64}
                pattern="[a-z0-9_-]+"
                placeholder="before-release"
              />
            </label>
            <button type="submit" className={primary} disabled={busy || info.unborn}>
              Create checkpoint
            </button>
          </form>
          <p className="mt-1.5 text-xs text-slate-500">
            Use 1–64 lowercase letters, numbers, underscores, or hyphens.
          </p>

          {info.snapshots.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-800 border-t border-slate-800">
              {info.snapshots.map((snapshot) => (
                <li key={snapshot.tag} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-slate-100 break-all">
                      {snapshot.tag.replace('panic_room_launchpadre_', '')}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-400">
                      {snapshot.head.slice(0, 12)}
                      {snapshot.created_at ? ` · ${formatTimestamp(snapshot.created_at)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => setRestore(snapshot)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No checkpoints yet.</p>
          )}

          {restore && (
            <div
              className="mt-4 rounded-xl border border-amber-500/60 bg-amber-950/20 p-4"
              role="group"
              aria-label="Confirm checkpoint restore"
            >
              <p className="text-sm text-slate-200 break-words">
                Restore <code className="text-amber-300">{restore.tag.replace('panic_room_launchpadre_', '')}</code>? This resets{' '}
                <code className="text-slate-100">{info.relative_path}</code> to{' '}
                <code className="text-amber-300">{restore.head.slice(0, 12)}</code>. Your current commit will be preserved in a unique recovery ref. All tracked, untracked, and ignored files must be clean.
              </p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  className={primary}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await request('restore', 'POST', {
                        tag: restore.tag,
                        expected_head: info.head,
                        expected_target: restore.head,
                      });
                      setRestore(undefined);
                      setRecoveryRef(result.recoveryRef || '');
                      setMessage('Restored checkpoint. Your previous commit is preserved at the recovery ref below.');
                    })
                  }
                >
                  Confirm restore
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => setRestore(undefined)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
