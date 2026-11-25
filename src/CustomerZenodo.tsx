import React, { useEffect, useState } from 'react';
import { Archive, Check, Copy, ExternalLink, ShieldAlert } from 'lucide-react';
import type { PlanId } from './plans.ts';

type ZenodoArchive = {
  id: string;
  repository_id: string;
  commit_sha: string;
  deposition_id: string;
  status: 'draft' | 'published';
  doi: string | null;
  doi_url: string | null;
  badge_url: string | null;
  sandbox: boolean;
  title: string;
  description: string;
  creator_name: string;
  creator_affiliation: string;
  archive_filename: string;
  archive_size_bytes: number;
  created_at: string;
  published_at: string | null;
};

type ZenodoState = {
  configured: boolean;
  sandbox: boolean;
  allowed: boolean;
  archives: ZenodoArchive[];
};

const field =
  'mt-1.5 min-w-0 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-amber-400';
const button =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer';
const primary =
  'inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50 cursor-pointer';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CustomerZenodo({
  repositoryId,
  repositoryName,
  plan,
  gitConnected,
  onUnauthorized,
}: {
  repositoryId: string;
  repositoryName: string;
  plan: PlanId;
  gitConnected: boolean;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<ZenodoState>();
  const [title, setTitle] = useState(`${repositoryName} Software Archive`);
  const [creatorName, setCreatorName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmPublish, setConfirmPublish] = useState<ZenodoArchive>();
  const [copiedId, setCopiedId] = useState('');

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
    if (!response.ok) throw new Error(result.error || 'Zenodo request failed');
    return result;
  }

  useEffect(() => {
    let active = true;
    setError('');
    request('zenodo')
      .then((data: ZenodoState) => {
        if (active) setState(data);
      })
      .catch((err) => {
        if (active && err.message !== 'Session expired') setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [repositoryId, plan]);

  async function createDraft(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('zenodo/drafts', 'POST', {
        title,
        creator_name: creatorName,
        creator_affiliation: affiliation,
        description,
      });
      setMessage('Draft archive uploaded to Zenodo. Review and confirm before publishing a permanent DOI.');
      setState(await request('zenodo'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare Zenodo draft');
    } finally {
      setBusy(false);
    }
  }

  async function publishDraft(archive: ZenodoArchive) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const published: ZenodoArchive = await request(`zenodo/drafts/${archive.id}/publish`, 'POST', {
        confirm: true,
      });
      setConfirmPublish(undefined);
      setMessage(`Published permanent DOI ${published.doi}.`);
      setState(await request('zenodo'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish DOI');
    } finally {
      setBusy(false);
    }
  }

  function copyBadge(archive: ZenodoArchive) {
    if (!archive.doi || !archive.doi_url || !archive.badge_url) return;
    const markdown = `[![DOI](${archive.badge_url})](${archive.doi_url})`;
    void navigator.clipboard?.writeText(markdown);
    setCopiedId(archive.id);
    setTimeout(() => setCopiedId((prev) => (prev === archive.id ? '' : prev)), 2000);
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6" aria-labelledby="zenodo-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 id="zenodo-title" className="text-lg font-semibold text-slate-100">
              Academic DOI Archival (Zenodo)
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Package committed HEAD into a clean archive, upload a draft to Zenodo, and mint a permanent DOI after confirmation.
          </p>
        </div>
        {state && (
          <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300">
            {state.configured ? (state.sandbox ? 'Zenodo Sandbox' : 'Zenodo Production') : 'Not configured'}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-900/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 rounded-lg border border-emerald-900/80 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          {message}
        </p>
      )}

      {!state && !error && <p className="mt-3 text-sm text-slate-400">Loading archival status…</p>}

      {state && !state.allowed && (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
          Preparing and publishing Zenodo archives requires the <strong className="text-amber-300">Academic Researcher</strong> plan.
          Existing archives remain accessible below.
        </p>
      )}

      {state && state.allowed && !state.configured && (
        <p className="mt-3 text-sm text-slate-400">
          The workspace operator needs to configure <code className="text-slate-200">ZENODO_ACCESS_TOKEN</code> to enable archival uploads.
        </p>
      )}

      {state && state.allowed && state.configured && !gitConnected && (
        <p className="mt-3 text-sm text-slate-400">
          Connect this repository to Git above before preparing a committed-HEAD Zenodo archive.
        </p>
      )}

      {state && state.allowed && state.configured && gitConnected && (
        <form onSubmit={createDraft} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-300 sm:col-span-2">
            Archive title
            <input
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
              maxLength={300}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Creator name
            <input
              className={field}
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="Last, First"
              required
              maxLength={200}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Affiliation (optional)
            <input
              className={field}
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              placeholder="University or Lab"
              maxLength={300}
            />
          </label>
          <label className="block text-sm text-slate-300 sm:col-span-2">
            Description (optional)
            <textarea
              className={field}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summary of the archived release"
              maxLength={5000}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className={primary} disabled={busy}>
              {busy ? 'Uploading draft…' : 'Prepare Zenodo draft'}
            </button>
          </div>
        </form>
      )}

      {state && state.archives.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-800 border-t border-slate-800">
          {state.archives.map((archive) => (
            <li key={archive.id} className="py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-100 break-words">{archive.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        archive.status === 'published'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-amber-950 text-amber-300 border border-amber-800'
                      }`}
                    >
                      {archive.status === 'published' ? 'Published' : 'Draft'}
                    </span>
                    {archive.sandbox && (
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
                        Sandbox
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-400">
                    {archive.commit_sha.slice(0, 12)} · {archive.archive_filename} ({formatBytes(archive.archive_size_bytes)})
                  </p>
                  {archive.doi && archive.doi_url && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <a
                        href={archive.doi_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-amber-300 hover:underline"
                      >
                        DOI: {archive.doi}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                      <button type="button" className={button} onClick={() => copyBadge(archive)}>
                        {copiedId === archive.id ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                            Copied badge
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            Copy Markdown badge
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
                {archive.status === 'draft' && state.allowed && state.configured && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => setConfirmPublish(archive)}
                  >
                    Publish DOI
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmPublish && (
        <div
          className="mt-4 rounded-xl border border-amber-500/60 bg-amber-950/20 p-4"
          role="group"
          aria-label="Confirm Zenodo DOI publication"
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm text-slate-200">
              <p>
                Publish <strong>{confirmPublish.title}</strong> ({confirmPublish.commit_sha.slice(0, 12)}) to{' '}
                {confirmPublish.sandbox ? 'Zenodo Sandbox' : 'Zenodo'}? Publishing mints a permanent DOI and locks the uploaded archive.
              </p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  className={primary}
                  disabled={busy}
                  onClick={() => void publishDraft(confirmPublish)}
                >
                  Confirm &amp; publish DOI
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => setConfirmPublish(undefined)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
