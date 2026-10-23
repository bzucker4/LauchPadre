import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  Search,
  Copy,
  Check,
  Send,
  Download,
  Trash2,
  FileCode,
  Award,
  ExternalLink,
  CreditCard,
  FileArchive,
  RefreshCw,
  Layers,
} from 'lucide-react';

export default function LaunchPadreDashboard() {
  const [activeTab, setActiveTab] = useState('panic_room');
  const [engineState, setEngineState] = useState(() => ({
    users: [
      { id: 1, username: 'elena_solo', email: 'elena@launchpadre.dev', plan: 'indie_solo', is_premium: true, stripe_customer_id: 'cus_elena_4092' },
      { id: 2, username: 'prof_turner', email: 'turner@stanford.edu', plan: 'academic_tier', is_premium: true, stripe_customer_id: 'cus_turner_8814' }
    ],
    repositories: [
      { id: 1, owner_id: 1, forgejo_repo_id: 4092, name: 'launchpadre-core', full_name: 'craftgit/launchpadre-core', default_branch: 'main', head_commit_sha: '91b7e4d20a8c3f567890123456789abcdef98765', is_unborn_head: false },
      { id: 2, owner_id: 2, forgejo_repo_id: 8814, name: 'zenodo-doi-engine', full_name: 'craftgit/zenodo-doi-engine', default_branch: 'main', head_commit_sha: '2a4e6b8c0d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a', is_unborn_head: false },
      { id: 3, owner_id: 1, forgejo_repo_id: 9940, name: 'fresh-unborn-repo', full_name: 'craftgit/fresh-unborn-repo', default_branch: 'main', head_commit_sha: '', is_unborn_head: true }
    ],
    tasks: [],
    commits: [],
    academic_dois: [
      { id: 1, repository_id: 1, commit_sha: '91b7e4d20a8c3f567890123456789abcdef98765', deposition_id: '10884920', doi: '10.5281/zenodo.10884920', doi_url: 'https://doi.org/10.5281/zenodo.10884920', badge_url: 'https://zenodo.org/badge/DOI/10.5281/zenodo.10884920.svg', title: 'LaunchPadre Core Engine v1.0.0 — Open Source Git Forge Architecture', archive_filename: 'launchpadre_core_91b7e4d2.zip', archive_size_bytes: 428900, creator_name: 'Elena Rostova', creator_affiliation: 'LaunchPadre Systems Research', minted_at: '2026-10-22T19:40:00Z' }
    ],
    panic_snapshots: [
      { id: 'ps_1', repository_id: 1, forgejo_repo_id: 4092, tag_name: 'panic_room_launchpadre_baseline_stable', sanitized_name: 'baseline_stable', target_commit_sha: '8f3d9a12b4e6c7d890123456789abcdef0123456', commit_message: 'feat(core): initial production bootstrap', author_name: 'Elena Rostova', author_email: 'elena@launchpadre.dev', created_at: '2026-10-22T15:00:00Z', is_head_commit: false, message: 'Pre-migration verified baseline release snapshot' },
      { id: 'ps_2', repository_id: 1, forgejo_repo_id: 4092, tag_name: 'panic_room_launchpadre_pre_fintech_deployment', sanitized_name: 'pre_fintech_deployment', target_commit_sha: '91b7e4d20a8c3f567890123456789abcdef98765', commit_message: 'feat(fintech): ship Stripe & Zenodo engine', author_name: 'Elena Rostova', author_email: 'elena@launchpadre.dev', created_at: '2026-10-22T19:30:00Z', is_head_commit: true, message: 'Checkpoint before Stripe webhook listener activation' }
    ],
    untracked_slop: [],
    scraper_probes: [],
    audit_logs: [],
    source_files: {}
  }));
  const [selectedRepoId, setSelectedRepoId] = useState(4092);
  const [copiedId, setCopiedId] = useState(null);

  // Panic Room States
  const [snapshotName, setSnapshotName] = useState('pre_assistant_refactor');
  const [snapshotNote, setSnapshotNote] = useState('Baseline checkpoint prior to autonomous agent session');
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [isExecutingRollback, setIsExecutingRollback] = useState(false);
  const [rollbackOutcome, setRollbackOutcome] = useState(null);

  // Zenodo DOI States
  const [doiTitle, setDoiTitle] = useState('LaunchPadre Core Engine — Reproducible Git Infrastructure');
  const [creatorName, setCreatorName] = useState('Elena Rostova');
  const [affiliation, setAffiliation] = useState('LaunchPadre Systems Research');
  const [doiDescription, setDoiDescription] = useState('Frozen research software code archive published via LaunchPadre.');
  const [isMintingDoi, setIsMintingDoi] = useState(false);
  const [mintedDoiResult, setMintedDoiResult] = useState(null);

  // Stripe Monetization States
  const [selectedUserId, setSelectedUserId] = useState(1);
  const [checkoutData, setCheckoutData] = useState(null);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [webhookOutcome, setWebhookOutcome] = useState(null);

  // Data Sovereignty Probe States
  const [probeAgent, setProbeAgent] = useState('GPTBot/1.2 (+https://openai.com/gptbot)');
  const [probeOutcome, setProbeOutcome] = useState(null);
  const [isProbing, setIsProbing] = useState(false);

  // Source Viewer File
  const [activeSourceFile, setActiveSourceFile] = useState('panic_room.py');

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/state');
      if (res.ok) {
        const data = await res.json();
        setEngineState(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const currentRepo = useMemo(() => {
    return (
      engineState?.repositories?.find((r) => r.forgejo_repo_id === selectedRepoId) ||
      engineState?.repositories?.[0] ||
      null
    );
  }, [engineState, selectedRepoId]);

  const currentRepoSnapshots = useMemo(() => {
    if (!currentRepo || !engineState?.panic_snapshots) return [];
    return engineState.panic_snapshots.filter((s) => s.repository_id === currentRepo.id);
  }, [currentRepo, engineState]);

  const currentRepoDois = useMemo(() => {
    if (!currentRepo || !engineState?.academic_dois) return [];
    return engineState.academic_dois.filter((d) => d.repository_id === currentRepo.id);
  }, [currentRepo, engineState]);

  const currentUser = useMemo(() => {
    return engineState?.users?.find((u) => u.id === selectedUserId) || engineState?.users?.[0] || null;
  }, [engineState, selectedUserId]);

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((p) => (p === id ? null : p)), 1800);
  };

  const handleDownload = (filename, content) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Task 1: Create Snapshot (with Unborn HEAD auto-initialization)
  const handleCreateSnapshot = async (e) => {
    if (e) e.preventDefault();
    if (!currentRepo || !snapshotName.trim()) return;

    setIsCreatingSnapshot(true);
    try {
      const res = await fetch('/api/v1/panic/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: currentRepo.forgejo_repo_id,
          snapshot_name: snapshotName.trim(),
          message: snapshotNote.trim(),
        }),
      });
      if (res.ok) {
        setSnapshotName(`checkpoint_${Date.now().toString().slice(-4)}`);
        await fetchState();
      }
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  // Task 1: Emergency Hard Reset
  const handleRollback = async (name) => {
    if (!currentRepo) return;
    setIsExecutingRollback(true);
    try {
      const res = await fetch('/api/v1/panic/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: currentRepo.forgejo_repo_id,
          snapshot_name: name,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRollbackOutcome(data);
        await fetchState();
      }
    } finally {
      setIsExecutingRollback(false);
    }
  };

  // Inject AI Slop file for testing
  const handleGenerateSlop = async () => {
    if (!currentRepo) return;
    await fetch('/api/v1/panic/slop/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_id: currentRepo.id }),
    });
    await fetchState();
  };

  // Mint Zenodo DOI
  const handleMintDoi = async (e) => {
    e.preventDefault();
    if (!currentRepo) return;
    setIsMintingDoi(true);
    try {
      const res = await fetch('/api/v1/academic/doi/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: currentRepo.forgejo_repo_id,
          title: doiTitle.trim(),
          description: doiDescription.trim(),
          creator_name: creatorName.trim(),
          creator_affiliation: affiliation.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMintedDoiResult(data);
        await fetchState();
      }
    } finally {
      setIsMintingDoi(false);
    }
  };

  // Create Stripe Checkout Session
  const handleCheckout = async (planId) => {
    if (!currentUser) return;
    setIsCreatingCheckout(true);
    try {
      const res = await fetch('/api/v1/billing/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          plan_id: planId,
        }),
      });
      const data = await res.json();
      if (res.ok) setCheckoutData(data);
    } finally {
      setIsCreatingCheckout(false);
    }
  };

  // Simulate Stripe Webhook
  const handleSimulateWebhook = async (eventType) => {
    if (!currentUser) return;
    const res = await fetch('/api/v1/billing/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1600000000,v1=simulated_hex',
      },
      body: JSON.stringify({
        type: eventType,
        data: {
          object: {
            client_reference_id: String(currentUser.id),
            customer: currentUser.stripe_customer_id || `cus_${currentUser.username}`,
            subscription: `sub_stripe_${Date.now().toString().slice(-6)}`,
            metadata: { plan_id: 'academic_tier' },
          },
        },
      }),
    });
    const data = await res.json();
    setWebhookOutcome(data);
    await fetchState();
  };

  // Scraper Probe
  const handleProbe = async (preset) => {
    const agent = preset || probeAgent;
    setIsProbing(true);
    try {
      const res = await fetch('/api/v1/sovereignty/test-probe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': agent,
        },
        body: JSON.stringify({ user_agent: agent }),
      });
      const data = await res.json();
      setProbeOutcome(data);
      await fetchState();
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070b19] text-slate-100 flex flex-col font-sans selection:bg-amber-500/20 selection:text-amber-200">
      {/* LaunchPadre Top Bar Header */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 bg-[#070b19]/95 sticky top-0 z-30 backdrop-blur-md">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('panic_room');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display flex items-center gap-2"
        >
          <span className="w-2.5 h-2.5 bg-amber-400 rounded-sm inline-block"></span>
          <span>LaunchPadre</span>
        </a>

        {/* 6 Clean Navigation Tabs */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('panic_room')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'panic_room' ? 'text-slate-100 border-amber-400 font-semibold' : 'border-transparent hover:text-slate-200'
            }`}
          >
            Panic Room Engine
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('zenodo')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'zenodo' ? 'text-slate-100 border-amber-400 font-semibold' : 'border-transparent hover:text-slate-200'
            }`}
          >
            Zenodo Academic DOI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stripe')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'stripe' ? 'text-slate-100 border-amber-400 font-semibold' : 'border-transparent hover:text-slate-200'
            }`}
          >
            Stripe Monetization
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sovereignty')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'sovereignty' ? 'text-slate-100 border-amber-400 font-semibold' : 'border-transparent hover:text-slate-200'
            }`}
          >
            Data Sovereignty
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('kanban')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'kanban' ? 'text-slate-100 border-amber-400 font-semibold' : 'border-transparent hover:text-slate-200'
            }`}
          >
            Kanban Board
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('source')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'source' ? 'text-slate-100 border-amber-400 font-semibold' : 'border-transparent hover:text-slate-200'
            }`}
          >
            Python Source
          </button>
        </nav>

        {/* Primary Action Button */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              if (currentRepoSnapshots.length > 0) {
                handleRollback(currentRepoSnapshots[0].sanitized_name);
              } else {
                handleCreateSnapshot();
              }
            }}
            disabled={isExecutingRollback}
            className="px-4 py-2 text-xs font-semibold text-rose-100 bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 shadow-xs"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{isExecutingRollback ? 'Purging Slop...' : 'Emergency Hard Reset'}</span>
          </button>
        </div>
      </header>

      {/* Main Tactical Canvas Container */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 py-8 space-y-8">
        {/* Workspace Sub-Header & Metrics Badges */}
        <section className="border-b border-slate-800/80 pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="text-xs font-mono text-slate-400 flex items-center gap-2 flex-wrap">
              <span>LaunchPadre Workspace</span>
              <span aria-hidden="true">·</span>
              <span>Solo Developer Platform</span>
              <span aria-hidden="true">·</span>
              <span>Git Hard-Reset Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100 font-display">
              LaunchPadre Developer Console
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Tactical engineering console for Git repository snapshotting, AI untracked file purging via <code className="text-slate-200 font-mono">git clean -fd</code>, and 3-layer anti-LLM scraper defense.
            </p>
          </div>

          {/* Repository Selector Toolbar */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-[#0b132b] border border-slate-800 rounded-lg">
              {engineState?.repositories?.map((repo) => (
                <button
                  key={repo.forgejo_repo_id}
                  type="button"
                  onClick={() => setSelectedRepoId(repo.forgejo_repo_id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedRepoId === repo.forgejo_repo_id
                      ? 'bg-slate-800 text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {repo.name}{' '}
                  {repo.is_unborn_head ? (
                    <span className="text-amber-400 text-[11px] font-mono">(Unborn HEAD)</span>
                  ) : (
                    <span className="font-mono text-slate-500">#{repo.forgejo_repo_id}</span>
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={async () => {
                await fetch('/api/v1/state/reset', { method: 'POST' });
                await fetchState();
              }}
              className="px-3 py-2 text-xs font-medium text-slate-300 bg-[#0b132b] border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset State</span>
            </button>
          </div>
        </section>

        {/* 4-Column Quantitative KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-[#0b132b] border border-slate-800/90 rounded-lg">
            <div className="text-xs text-slate-400">Current Worktree HEAD</div>
            <div className="mt-1 text-base font-semibold text-slate-100 font-mono truncate launchpadre-sha">
              {currentRepo?.is_unborn_head ? (
                <span className="text-amber-300">Unborn HEAD (0 commits)</span>
              ) : (
                <span className="text-slate-100">{currentRepo?.head_commit_sha?.slice(0, 16)}…</span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-400 font-mono">
              repo: {currentRepo?.name} · {currentRepo?.default_branch}
            </div>
          </div>

          <div className="p-4 bg-[#0b132b] border border-slate-800/90 rounded-lg">
            <div className="text-xs text-slate-400">Panic Haven Snapshots</div>
            <div className="mt-1 text-base font-semibold text-amber-300 font-mono tabular-nums">
              {currentRepoSnapshots.length} Checkpoints
            </div>
            <div className="mt-1 text-xs text-slate-400 font-mono launchpadre-tag">
              panic_room_launchpadre_*
            </div>
          </div>

          <div className="p-4 bg-[#0b132b] border border-slate-800/90 rounded-lg">
            <div className="text-xs text-slate-400">Untracked AI Slop in Worktree</div>
            <div className={`mt-1 text-base font-semibold font-mono tabular-nums ${
              (engineState?.untracked_slop?.filter((s) => s.repository_id === currentRepo?.id)?.length || 0) > 0
                ? 'text-rose-400'
                : 'text-emerald-400'
            }`}>
              {engineState?.untracked_slop?.filter((s) => s.repository_id === currentRepo?.id)?.length || 0} Dangling File(s)
            </div>
            <div className="mt-1 text-xs text-slate-400 font-mono">
              Purged via git clean -fd
            </div>
          </div>

          <div className="p-4 bg-[#0b132b] border border-slate-800/90 rounded-lg">
            <div className="text-xs text-slate-400">Data Sovereignty Shield</div>
            <div className="mt-1 text-base font-semibold text-slate-100 font-mono tabular-nums">
              {engineState?.scraper_probes?.filter((p) => p.status === 'intercepted_403')?.length || 0} Blocked AI Bots
            </div>
            <div className="mt-1 text-xs text-slate-400 font-mono">
              Layer B 403 Forbidden drops
            </div>
          </div>
        </section>

        {/* TAB 1: PANIC ROOM ENGINE */}
        {activeTab === 'panic_room' && (
          <section className="space-y-6">
            {currentRepo?.is_unborn_head && (
              <div className="p-4 bg-amber-950/20 border border-amber-700/60 rounded-lg flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Unborn HEAD Detected On Fresh Repository</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Repository has 0 commits. Clicking &quot;Create Haven Snapshot&quot; will automatically trigger LaunchPadre&apos;s Unborn HEAD patch: staging <code className="font-mono text-slate-100">.launchpadre_init</code> and committing a baseline tracking entry without throwing Git exceptions.
                  </p>
                </div>
              </div>
            )}

            {rollbackOutcome && (
              <div className="p-5 bg-rose-950/20 border border-rose-800/80 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-rose-300 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Emergency Hard Reset Executed: Clean Worktree Restored</span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">{rollbackOutcome.executed_at}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                    <span className="text-slate-400 block">Restored Tag:</span>
                    <span className="text-amber-300 font-semibold">{rollbackOutcome.tag_name}</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                    <span className="text-slate-400 block">Restored Commit SHA:</span>
                    <span className="text-slate-200">{rollbackOutcome.target_commit_sha}</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                    <span className="text-slate-400 block">Wiped Untracked Slop:</span>
                    <span className="text-rose-400 font-semibold">
                      {rollbackOutcome.purged_untracked_count} items purged via git clean -fd
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Snapshot Creator Card */}
              <div className="lg:col-span-5 bg-[#0b132b] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100 font-display">
                    Create Haven Snapshot
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Forces an un-detached Git tag <code className="text-amber-300 font-mono">panic_room_launchpadre_&lt;name&gt;</code> pointing to current HEAD.
                  </p>
                </div>

                <form onSubmit={handleCreateSnapshot} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 block">
                      Snapshot Tag Segment Name
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-mono text-slate-500">
                        panic_room_launchpadre_
                      </span>
                      <input
                        type="text"
                        value={snapshotName}
                        onChange={(e) => setSnapshotName(e.target.value)}
                        className="w-full pl-48 pr-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 block">
                      Annotation Note
                    </label>
                    <input
                      type="text"
                      value={snapshotNote}
                      onChange={(e) => setSnapshotNote(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isCreatingSnapshot || !snapshotName.trim()}
                    className="w-full py-2.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isCreatingSnapshot ? 'Creating Snapshot...' : 'POST /api/v1/panic/snapshots'}
                  </button>
                </form>

                {/* AI Slop Injection Test Box */}
                <div className="pt-4 border-t border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-200">
                        Test Worktree File Slop
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Simulate broken AI assistant output in repo
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateSlop}
                      className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      + Inject Slop File
                    </button>
                  </div>
                </div>
              </div>

              {/* Snapshot Catalog */}
              <div className="lg:col-span-7 bg-[#0b132b] border border-slate-800/90 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-100 font-display">
                    Safe Haven Checkpoints
                  </h2>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {currentRepoSnapshots.length} snapshot(s)
                  </span>
                </div>

                <div className="space-y-3">
                  {currentRepoSnapshots.length === 0 ? (
                    <div className="py-12 px-4 text-center border border-dashed border-slate-800 rounded-lg">
                      <p className="text-xs text-slate-400">No snapshots generated yet.</p>
                    </div>
                  ) : (
                    currentRepoSnapshots.map((snap) => (
                      <div
                        key={snap.id}
                        className={`p-4 bg-slate-900 border rounded-lg space-y-3 ${
                          snap.is_head_commit ? 'border-amber-500/50 bg-slate-900/90' : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className="text-sm font-semibold font-mono text-amber-300">
                              {snap.tag_name}
                            </span>
                            <p className="text-xs text-slate-300 mt-0.5">{snap.commit_message}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRollback(snap.sanitized_name)}
                            disabled={isExecutingRollback}
                            className="px-3 py-1.5 text-xs font-semibold text-rose-200 bg-rose-950/60 border border-rose-800 hover:bg-rose-900/70 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Hard Reset &amp; Sweep</span>
                          </button>
                        </div>
                        <div className="pt-2 border-t border-slate-800 text-xs font-mono text-slate-400 flex items-center justify-between tabular-nums">
                          <span>commit: {snap.target_commit_sha?.slice(0, 10)}…</span>
                          <span>{snap.created_at?.slice(0, 19).replace('T', ' ')}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 2: ZENODO ACADEMIC DOI */}
        {activeTab === 'zenodo' && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-6 bg-[#0b132b] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100 font-display flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span>Mint Zenodo Academic DOI</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Bundles repository worktree into clean <code className="text-slate-200 font-mono">.zip</code> (ignoring <code className="text-slate-200 font-mono">.git</code>), streams it to Zenodo, injects CSL metadata, and locks the deposition.
                  </p>
                </div>

                <form onSubmit={handleMintDoi} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 block">Software Title</label>
                    <input
                      type="text"
                      value={doiTitle}
                      onChange={(e) => setDoiTitle(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300 block">Creator Name</label>
                      <input
                        type="text"
                        value={creatorName}
                        onChange={(e) => setCreatorName(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300 block">Affiliation</label>
                      <input
                        type="text"
                        value={affiliation}
                        onChange={(e) => setAffiliation(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 block">Abstract</label>
                    <textarea
                      rows={3}
                      value={doiDescription}
                      onChange={(e) => setDoiDescription(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isMintingDoi}
                    className="w-full py-2.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>{isMintingDoi ? 'Packaging & Minting DOI...' : 'POST /api/v1/academic/doi/mint'}</span>
                  </button>
                </form>

                {mintedDoiResult && (
                  <div className="p-4 bg-emerald-950/20 border border-emerald-800/70 rounded-md space-y-2 font-mono text-xs">
                    <div className="text-emerald-300 font-semibold">✓ Permanent DOI Registered</div>
                    <div className="text-slate-100 text-sm font-bold">{mintedDoiResult.doi}</div>
                    <a
                      href={mintedDoiResult.doi_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-300 hover:underline flex items-center gap-1"
                    >
                      <span>{mintedDoiResult.doi_url}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {/* Minted DOI Table */}
              <div className="lg:col-span-6 bg-[#0b132b] border border-slate-800/90 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-100 font-display">
                    academic_doi_registries Table
                  </h3>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {currentRepoDois.length} registered
                  </span>
                </div>

                <div className="space-y-3">
                  {currentRepoDois.length === 0 ? (
                    <div className="py-12 px-4 text-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-400">
                      No academic DOIs minted for this repository yet.
                    </div>
                  ) : (
                    currentRepoDois.map((entry) => (
                      <div key={entry.id} className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className="text-sm font-bold font-mono text-amber-300">{entry.doi}</span>
                            <h4 className="text-xs font-semibold text-slate-100 mt-0.5">{entry.title}</h4>
                            <p className="text-[11px] text-slate-400">{entry.creator_name} ({entry.creator_affiliation})</p>
                          </div>
                          <a
                            href={entry.doi_url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center gap-1 shrink-0"
                          >
                            <span>DOI Link</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="pt-2 border-t border-slate-800 text-[11px] font-mono text-slate-500 flex items-center justify-between tabular-nums">
                          <span>commit: {entry.commit_sha?.slice(0, 10)}…</span>
                          <span>minted: {entry.minted_at?.slice(0, 19).replace('T', ' ')}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 3: STRIPE MONETIZATION */}
        {activeTab === 'stripe' && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className={`p-5 bg-[#0b132b] border rounded-lg space-y-3 ${
                currentUser?.plan === 'free' ? 'border-amber-400' : 'border-slate-800'
              }`}>
                <div className="text-xs font-mono text-slate-400">Tier 01</div>
                <h3 className="text-base font-bold text-slate-100 font-display">Free Developer</h3>
                <div className="text-xl font-bold font-mono">$0 <span className="text-xs font-normal text-slate-400">/mo</span></div>
                <ul className="text-xs text-slate-300 space-y-1.5">
                  <li>✓ 3 Repositories</li>
                  <li>✓ 1 Panic Snapshot</li>
                </ul>
              </div>

              <div className={`p-5 bg-[#0b132b] border rounded-lg space-y-3 ${
                currentUser?.plan === 'indie_solo' ? 'border-amber-400 ring-1 ring-amber-400' : 'border-slate-800'
              }`}>
                <div className="text-xs font-mono text-amber-300">Tier 02 · Recommended</div>
                <h3 className="text-base font-bold text-slate-100 font-display">Indie Solo</h3>
                <div className="text-xl font-bold font-mono">$12 <span className="text-xs font-normal text-slate-400">/mo</span></div>
                <ul className="text-xs text-slate-300 space-y-1.5">
                  <li>✓ Unlimited Repositories</li>
                  <li>✓ Panic Room Hard Reset Engine</li>
                  <li>✓ Filesystem Slop Sweep (git clean -fd)</li>
                </ul>
                <button
                  type="button"
                  onClick={() => handleCheckout('indie_solo')}
                  disabled={isCreatingCheckout}
                  className="w-full py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded cursor-pointer"
                >
                  Subscribe to Indie Solo
                </button>
              </div>

              <div className={`p-5 bg-[#0b132b] border rounded-lg space-y-3 ${
                currentUser?.plan === 'academic_tier' ? 'border-amber-400 ring-1 ring-amber-400' : 'border-slate-800'
              }`}>
                <div className="text-xs font-mono text-amber-300">Tier 03 · Institutions</div>
                <h3 className="text-base font-bold text-slate-100 font-display">Academic Researcher</h3>
                <div className="text-xl font-bold font-mono">$29 <span className="text-xs font-normal text-slate-400">/mo</span></div>
                <ul className="text-xs text-slate-300 space-y-1.5">
                  <li>✓ All Indie Solo features</li>
                  <li>✓ Automated Zenodo DOI Minting</li>
                  <li>✓ Permanent Citation Badges</li>
                </ul>
                <button
                  type="button"
                  onClick={() => handleCheckout('academic_tier')}
                  disabled={isCreatingCheckout}
                  className="w-full py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded cursor-pointer"
                >
                  Subscribe to Academic
                </button>
              </div>
            </div>

            {/* Simulated Webhook Controls */}
            <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-3">
              <h3 className="text-sm font-semibold text-slate-100 font-display">
                Stripe Webhook Lifecycle Simulator
              </h3>
              <p className="text-xs text-slate-400">
                Trigger simulated Stripe webhook payloads to test asynchronous user upgrades and downgrades via <code className="font-mono text-slate-200">POST /api/v1/billing/webhooks/stripe</code>.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => handleSimulateWebhook('checkout.session.completed')}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-950/60 border border-emerald-700 text-emerald-200 hover:bg-emerald-900/80 rounded transition-colors cursor-pointer"
                >
                  Simulate checkout.session.completed
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulateWebhook('customer.subscription.deleted')}
                  className="px-3 py-1.5 text-xs font-medium bg-rose-950/60 border border-rose-700 text-rose-200 hover:bg-rose-900/80 rounded transition-colors cursor-pointer"
                >
                  Simulate customer.subscription.deleted
                </button>
              </div>
            </div>
          </section>
        )}

        {/* TAB 4: DATA SOVEREIGNTY */}
        {activeTab === 'sovereignty' && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-2">
                <span className="text-xs font-mono text-amber-300">Layer A</span>
                <h3 className="text-base font-semibold text-slate-100">Dynamic robots.txt</h3>
                <p className="text-xs text-slate-400">Disallows GPTBot, ClaudeBot, Bytespider from indexing public source trees.</p>
                <a href="/robots.txt" target="_blank" rel="noreferrer" className="text-xs font-mono text-amber-400 hover:underline inline-block pt-1">
                  View /robots.txt →
                </a>
              </div>
              <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-2">
                <span className="text-xs font-mono text-rose-400">Layer B</span>
                <h3 className="text-base font-semibold text-slate-100">User-Agent Interception</h3>
                <p className="text-xs text-slate-400">ASGI middleware terminates known scraper bots with flat 403 Forbidden.</p>
              </div>
              <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-2">
                <span className="text-xs font-mono text-emerald-400">Layer C</span>
                <h3 className="text-base font-semibold text-slate-100">SEO Control Header</h3>
                <p className="text-xs text-slate-400">Injects X-Robots-Tag: noindex, nofollow, noarchive on outbound responses.</p>
              </div>
            </div>

            {/* Probe test */}
            <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-4">
              <h3 className="text-sm font-semibold text-slate-100">Test Scraper User-Agent Drop</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={probeAgent}
                  onChange={(e) => setProbeAgent(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => handleProbe()}
                  disabled={isProbing}
                  className="px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded cursor-pointer"
                >
                  {isProbing ? 'Probing...' : 'Send Probe'}
                </button>
              </div>
              {probeOutcome && (
                <div className={`p-3 rounded border text-xs font-mono ${
                  probeOutcome.decision === 'BLOCKED' ? 'bg-rose-950/20 border-rose-800 text-rose-200' : 'bg-emerald-950/20 border-emerald-800 text-emerald-200'
                }`}>
                  HTTP {probeOutcome.status_code} · {probeOutcome.message}
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 5: KANBAN BOARD */}
        {activeTab === 'kanban' && engineState && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {['todo', 'in_progress', 'done'].map((statusKey) => {
                const tasksInCol = engineState.tasks?.filter((t) => t.status === statusKey) || [];
                return (
                  <div key={statusKey} className="bg-[#0b132b] border border-slate-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <h3 className="text-sm font-semibold capitalize font-mono text-slate-100">{statusKey}</h3>
                      <span className="text-xs font-mono text-slate-500 tabular-nums">{tasksInCol.length}</span>
                    </div>
                    {tasksInCol.map((task) => (
                      <div key={task.id} className="p-3 bg-slate-900 border border-slate-800 rounded space-y-1.5">
                        <div className="text-xs font-semibold text-slate-200">{task.title}</div>
                        <div className="text-[11px] font-mono text-amber-300/90">{task.markdown_file_path}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* TAB 6: PYTHON SOURCE VIEWER */}
        {activeTab === 'source' && engineState && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0b132b] border border-slate-800/90 rounded-lg p-4">
              <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
                {Object.keys(engineState.source_files || {}).map((fileKey) => (
                  <button
                    key={fileKey}
                    type="button"
                    onClick={() => setActiveSourceFile(fileKey)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      activeSourceFile === fileKey ? 'bg-slate-800 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    backend_python/{fileKey}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopy(`src-${activeSourceFile}`, engineState.source_files[activeSourceFile] || '')}
                  className="px-3 py-1.5 text-xs font-mono text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedId === `src-${activeSourceFile}` ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy {activeSourceFile}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(activeSourceFile, engineState.source_files[activeSourceFile] || '')}
                  className="px-3 py-1.5 text-xs font-mono text-slate-950 bg-amber-400 hover:bg-amber-300 font-semibold rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/70 text-xs font-mono text-slate-400">
                /backend_python/{activeSourceFile} · LaunchPadre Core Specification
              </div>
              <pre className="p-5 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed max-h-[700px]">
                {engineState.source_files[activeSourceFile]}
              </pre>
            </div>
          </section>
        )}
      </main>
      {/* Clean layout boundary: No leaking raw text footer */}
    </div>
  );
}
