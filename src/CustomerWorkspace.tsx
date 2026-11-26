import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Download,
  FolderGit2,
  KeyRound,
  ListTodo,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react';
import CustomerCheckpoints from './CustomerCheckpoints.tsx';
import CustomerZenodo from './CustomerZenodo.tsx';
import { PLANS, type PlanId } from './plans.ts';

export type CustomerProfile = { id: string; email: string; plan: PlanId; terms_current?: boolean };
type Repo = { id: string; name: string; created_at: string; git_path?: string | null; task_count?: number };
type TaskStatus = 'todo' | 'in_progress' | 'done';
type Task = { id: string; title: string; status: TaskStatus; created_at?: string };
type Offer = { plan: PlanId; interval: 'month' | 'year'; name: string; cents: number };
type BillingState = { plan: PlanId; mode: 'live' | 'test' | null; has_portal: boolean; offers: Offer[] };

const panel = 'rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6';
const field =
  'min-w-0 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-amber-400';
const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer';
const primary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer';
const dangerButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-900/70 focus-visible:outline-2 focus-visible:outline-rose-400 disabled:opacity-50 cursor-pointer';

function planLimitsText(plan: PlanId) {
  const details = PLANS[plan];
  const repos = details.repositories === null ? 'Unlimited repositories' : `Up to ${details.repositories} repositories`;
  const snaps =
    details.snapshotsPerRepository === null
      ? 'Unlimited checkpoints'
      : `${details.snapshotsPerRepository} checkpoint per repo`;
  const zenodo = details.zenodo ? 'Zenodo DOI archival' : 'No Zenodo archival';
  return `${repos} · ${snaps} · ${zenodo}`;
}

function Billing({
  checkoutReturn,
  onPlanChange,
  onUnauthorized,
}: {
  checkoutReturn: string | null;
  onPlanChange: (plan: PlanId) => void;
  onUnauthorized: () => void;
}) {
  const [billing, setBilling] = useState<BillingState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/customer/billing/offers');
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load billing');
      setBilling(data);
      if (data.plan) onPlanChange(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load billing. Try refreshing your plan.');
    }
  }, [onPlanChange, onUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function checkout(offer: Offer) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/customer/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: offer.plan, interval: offer.interval }),
      });
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || 'Could not start checkout');
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError('Could not start checkout');
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/customer/billing/portal', { method: 'POST' });
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || 'Could not open billing portal');
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError('Could not open billing portal');
    } finally {
      setBusy(false);
    }
  }

  const currentPlan: PlanId = billing?.plan ?? 'free';

  return (
    <section className={panel} aria-labelledby="subscription-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CreditCard className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 id="subscription-title" className="text-lg font-semibold text-slate-100">
              Subscription
            </h2>
            {billing?.mode && (
              <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-300">
                {billing.mode === 'live' ? 'Stripe Live' : 'Stripe Test Mode'}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-slate-300">
            {billing ? (
              <>
                Current plan <strong className="ml-1.5 text-amber-300">{PLANS[currentPlan].name}</strong>
              </>
            ) : (
              'Loading plan…'
            )}
          </p>
          {billing && <p className="mt-0.5 text-xs text-slate-400">{planLimitsText(currentPlan)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {billing?.has_portal && (
            <button type="button" className={button} disabled={busy} onClick={() => void openPortal()}>
              Manage subscription
            </button>
          )}
          <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh plan
          </button>
        </div>
      </div>

      {checkoutReturn === 'success' && (
        <p role="status" className="mt-4 rounded-lg border border-blue-900 bg-blue-950/60 p-3 text-sm text-blue-200">
          You returned from Stripe. If your subscription update is still processing, select Refresh plan in a moment.
        </p>
      )}
      {checkoutReturn === 'canceled' && (
        <p role="status" className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
          Checkout was canceled. Your current plan was not changed.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-rose-900/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      {billing && !billing.offers.length && billing.plan === 'free' && (
        <p className="mt-4 text-sm text-slate-400">
          Stripe billing is not configured on this server yet. You can continue using the Free Developer tier.
        </p>
      )}

      {billing?.plan === 'free' && billing.offers.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {billing.mode === 'live' ? 'Available upgrades' : 'Stripe sandbox plans'}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {billing.offers.map((offer) => (
              <button
                key={offer.plan + offer.interval}
                type="button"
                className="rounded-xl border border-slate-700 bg-slate-950 p-4 text-left transition-colors hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer"
                disabled={busy}
                onClick={() => void checkout(offer)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{offer.name}</span>
                  {offer.interval === 'year' && (
                    <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                      Save 35%
                    </span>
                  )}
                </div>
                <span className="mt-1 block text-sm font-medium text-amber-300 tabular-nums">
                  ${(offer.cents / 100).toFixed(2)} / {offer.interval}
                </span>
                <span className="mt-1.5 block text-xs text-slate-400">{planLimitsText(offer.plan)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PasswordPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/customer/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (response.status === 401 && (await response.clone().json().catch(() => ({}))).error === 'Unauthorized') {
        onUnauthorized();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update password');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Password updated. Other active sessions were signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panel} aria-labelledby="security-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <h2 id="security-title" className="text-lg font-semibold text-slate-100">
            Account Security
          </h2>
        </div>
        <button type="button" className={button} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide password form' : 'Change password'}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm text-slate-300">
            Current password
            <input
              type="password"
              className={field + ' mt-1.5'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="block text-sm text-slate-300">
            New password (12+ chars)
            <input
              type="password"
              className={field + ' mt-1.5'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <label className="block text-sm text-slate-300">
            Confirm new password
            <input
              type="password"
              className={field + ' mt-1.5'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
            <button type="submit" className={primary} disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
            {error && (
              <p role="alert" className="text-sm text-rose-300">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="inline-flex items-center gap-1.5 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {success}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

export function DataPanel({ onUnauthorized, onDeleted }: { onUnauthorized: () => void; onDeleted: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function exportData() {
    setError('');
    setExporting(true);
    try {
      const response = await fetch('/api/customer/export');
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error('Could not export your data');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'launchpadre-export.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export your data');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/customer/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirm: confirmText }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && data.error === 'Unauthorized') {
        onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Could not delete your account');
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panel} aria-labelledby="data-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <h2 id="data-title" className="text-lg font-semibold text-slate-100">
            Your Data
          </h2>
        </div>
        <button type="button" className={button} onClick={exportData} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Download my data (JSON)'}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        The export includes your account details, repositories, tasks and archive records. It never includes your
        password or sessions. Repository source stays in your own Git repositories.
      </p>

      <div className="mt-5 border-t border-slate-800 pt-4">
        {!confirming ? (
          <button type="button" className={dangerButton} onClick={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete my account
          </button>
        ) : (
          <form onSubmit={deleteAccount} className="space-y-3">
            <p className="text-sm text-rose-200">
              This permanently deletes your account, repositories, tasks and Git checkpoints, and cancels your
              subscription immediately with no refund for the current period. It cannot be undone. Anything already
              published to Zenodo stays public. Download your data first.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Password
                <input
                  type="password"
                  className={field + ' mt-1.5'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="block text-sm text-slate-300">
                Type DELETE to confirm
                <input
                  className={field + ' mt-1.5'}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={dangerButton} disabled={busy || confirmText !== 'DELETE'}>
                {busy ? 'Deleting…' : 'Permanently delete account'}
              </button>
              <button
                type="button"
                className={button}
                onClick={() => {
                  setConfirming(false);
                  setPassword('');
                  setConfirmText('');
                  setError('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export default function CustomerWorkspace({
  customer,
  checkoutReturn,
  onLogout,
  onSessionExpired,
  onAccountDeleted,
}: {
  customer: CustomerProfile;
  checkoutReturn: string | null;
  onLogout: () => void;
  onSessionExpired: () => void;
  onAccountDeleted: () => void;
}) {
  const [plan, setPlan] = useState<PlanId>(customer.plan);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selected, setSelected] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskFilter, setTaskFilter] = useState<'all' | TaskStatus>('all');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [confirmDeleteRepo, setConfirmDeleteRepo] = useState(false);
  const [gitConnected, setGitConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = useCallback(
    async (url: string, options?: RequestInit) => {
      const response = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
      });
      if (response.status === 401) {
        onSessionExpired();
        throw new Error('Session expired');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      return data;
    },
    [onSessionExpired]
  );

  const loadRepos = useCallback(async () => {
    try {
      const data: Repo[] = await request('/api/customer/repositories');
      setRepos(data);
      setSelected((prev) => {
        if (prev && data.some((r) => r.id === prev)) return prev;
        return data.length ? data[0].id : '';
      });
    } catch (e) {
      if (e instanceof Error && e.message !== 'Session expired') setError(e.message);
    }
  }, [request]);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  useEffect(() => {
    setConfirmDeleteRepo(false);
    setGitConnected(false);
    if (!selected) {
      setTasks([]);
      return;
    }
    request(`/api/customer/repositories/${selected}/tasks`)
      .then(setTasks)
      .catch((e) => {
        if (e instanceof Error && e.message !== 'Session expired') setError(e.message);
      });
  }, [selected, request]);

  const activeRepo = useMemo(() => repos.find((r) => r.id === selected) ?? null, [repos, selected]);

  const filteredTasks = useMemo(
    () => (taskFilter === 'all' ? tasks : tasks.filter((t) => t.status === taskFilter)),
    [tasks, taskFilter]
  );

  const taskCounts = useMemo(
    () => ({
      all: tasks.length,
      todo: tasks.filter((t) => t.status === 'todo').length,
      in_progress: tasks.filter((t) => t.status === 'in_progress').length,
      done: tasks.filter((t) => t.status === 'done').length,
    }),
    [tasks]
  );

  async function addRepo(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const repo = await request('/api/customer/repositories', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setName('');
      await loadRepos();
      setSelected(repo.id);
    } catch (err) {
      if (err instanceof Error && err.message !== 'Session expired') setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedRepo() {
    if (!activeRepo) return;
    setError('');
    setBusy(true);
    try {
      await request(`/api/customer/repositories/${activeRepo.id}`, { method: 'DELETE' });
      setConfirmDeleteRepo(false);
      setSelected('');
      await loadRepos();
    } catch (err) {
      if (err instanceof Error && err.message !== 'Session expired') setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError('');
    setBusy(true);
    try {
      await request(`/api/customer/repositories/${selected}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      setTitle('');
      setTasks(await request(`/api/customer/repositories/${selected}/tasks`));
    } catch (err) {
      if (err instanceof Error && err.message !== 'Session expired') setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateTaskStatus(taskId: string, status: TaskStatus) {
    setError('');
    try {
      await request(`/api/customer/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    } catch (err) {
      if (err instanceof Error && err.message !== 'Session expired') setError(err.message);
    }
  }

  async function deleteTask(taskId: string) {
    setError('');
    try {
      await request(`/api/customer/tasks/${taskId}`, { method: 'DELETE' });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (err) {
      if (err instanceof Error && err.message !== 'Session expired') setError(err.message);
    }
  }

  const repoLimit = PLANS[plan].repositories;

  return (
    <div className="min-h-screen bg-[#070b19] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#070b19]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-sm bg-amber-400" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-100">LaunchPadre</h1>
              <p className="text-xs text-slate-400">
                {customer.email} · <span className="text-amber-300">{PLANS[plan].name}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="hidden items-center gap-1.5 rounded-full border border-emerald-900/80 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-300 sm:inline-flex"
              title="AI scrapers blocked and noindex headers active"
            >
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              Data Sovereignty Active
            </span>
            <button
              type="button"
              className={button}
              onClick={async () => {
                await fetch('/api/customer/logout', { method: 'POST' });
                onLogout();
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
        <Billing checkoutReturn={checkoutReturn} onPlanChange={setPlan} onUnauthorized={onSessionExpired} />

        {error && (
          <p role="alert" className="rounded-xl border border-rose-900/80 bg-rose-950/40 p-3.5 text-sm text-rose-200">
            {error}
          </p>
        )}

        <section className={panel} aria-labelledby="repositories-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <h2 id="repositories-title" className="text-lg font-semibold text-slate-100">
                Repositories
              </h2>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300 tabular-nums">
              {repoLimit === null ? `${repos.length} · Unlimited` : `${repos.length} / ${repoLimit} on Free`}
            </span>
          </div>

          <form onSubmit={addRepo} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium text-slate-300">
              Repository name
              <input
                className={field + ' mt-1.5'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. launchpadre-core"
                required
                maxLength={120}
              />
            </label>
            <button type="submit" className={primary} disabled={busy}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add repository
            </button>
          </form>

          {repos.length > 0 ? (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-sm font-medium text-slate-300">
                Active repository
                <select
                  className={field + ' mt-1.5'}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Choose a repository</option>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.name}
                      {repo.git_path ? ` (${repo.git_path})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {activeRepo && !confirmDeleteRepo && (
                <button
                  type="button"
                  className={dangerButton}
                  disabled={busy}
                  onClick={() => setConfirmDeleteRepo(true)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete
                </button>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              Add a repository to organize tasks, connect Git checkpoints, and archive releases.
            </p>
          )}

          {activeRepo && confirmDeleteRepo && (
            <div className="mt-4 rounded-xl border border-rose-800/70 bg-rose-950/30 p-4 text-sm text-rose-100">
              <p>
                Delete repository record <strong>{activeRepo.name}</strong> and its tasks? (Files on disk inside the provisioned Git directory are never deleted.)
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={dangerButton} disabled={busy} onClick={() => void deleteSelectedRepo()}>
                  Confirm delete
                </button>
                <button type="button" className={button} disabled={busy} onClick={() => setConfirmDeleteRepo(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {activeRepo && (
          <CustomerCheckpoints
            key={activeRepo.id}
            repositoryId={activeRepo.id}
            plan={plan}
            onUnauthorized={onSessionExpired}
            onGitConnected={setGitConnected}
          />
        )}

        {activeRepo && (
          <CustomerZenodo
            key={`zenodo-${activeRepo.id}`}
            repositoryId={activeRepo.id}
            repositoryName={activeRepo.name}
            plan={plan}
            gitConnected={gitConnected}
            onUnauthorized={onSessionExpired}
          />
        )}

        {activeRepo && (
          <section className={panel} aria-labelledby="tasks-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <h2 id="tasks-title" className="text-lg font-semibold text-slate-100">
                  Tasks
                </h2>
              </div>
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter tasks">
                {(
                  [
                    ['all', `All (${taskCounts.all})`],
                    ['todo', `To do (${taskCounts.todo})`],
                    ['in_progress', `In progress (${taskCounts.in_progress})`],
                    ['done', `Done (${taskCounts.done})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={taskFilter === key}
                    onClick={() => setTaskFilter(key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      taskFilter === key
                        ? 'bg-amber-400 text-slate-950'
                        : 'border border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={addTask} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-sm font-medium text-slate-300">
                Task title
                <input
                  className={field + ' mt-1.5'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={250}
                  placeholder="Describe what needs to be built or verified"
                />
              </label>
              <button type="submit" className={primary} disabled={busy}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add task
              </button>
            </form>

            {filteredTasks.length > 0 ? (
              <ul className="mt-4 divide-y divide-slate-800 border-t border-slate-800">
                {filteredTasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span
                      className={`min-w-0 flex-1 text-sm break-words ${
                        task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-100'
                      }`}
                    >
                      {task.title}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        className={field + ' w-36 py-1.5'}
                        aria-label={`Status for ${task.title}`}
                        value={task.status}
                        onChange={(e) => void updateTaskStatus(task.id, e.target.value as TaskStatus)}
                      >
                        <option value="todo">To do</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                      <button
                        type="button"
                        aria-label={`Delete ${task.title}`}
                        className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-400 hover:border-rose-800 hover:text-rose-300 cursor-pointer"
                        onClick={() => void deleteTask(task.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                {tasks.length === 0 ? 'No tasks in this repository yet.' : 'No tasks match this filter.'}
              </p>
            )}
          </section>
        )}

        <PasswordPanel onUnauthorized={onSessionExpired} />
        <DataPanel onUnauthorized={onSessionExpired} onDeleted={onAccountDeleted} />
      </main>
    </div>
  );
}
