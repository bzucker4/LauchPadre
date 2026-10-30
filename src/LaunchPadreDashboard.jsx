import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { MetricsStrip } from './components/MetricsStrip';
import { PanicRoomTab } from './components/PanicRoomTab';
import { ZenodoTab } from './components/ZenodoTab';
import { StripeTab } from './components/StripeTab';
import { SovereigntyTab } from './components/SovereigntyTab';
import { KanbanTab } from './components/KanbanTab';
import { SourceViewerTab } from './components/SourceViewerTab';

export default function LaunchPadreDashboard() {
  const [activeTab, setActiveTab] = useState('panic_room');
  const [repositories, setRepositories] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);

  // Targeted repo data states
  const [snapshots, setSnapshots] = useState([]);
  const [dois, setDois] = useState([]);
  const [slop, setSlop] = useState([]);
  const [tasks, setTasks] = useState([]);

  // Global sub-system states
  const [currentUser, setCurrentUser] = useState(null);
  const [blockedBotsCount, setBlockedBotsCount] = useState(0);

  // Action status
  const [isExecutingRollback, setIsExecutingRollback] = useState(false);
  const [rollbackOutcome, setRollbackOutcome] = useState(null);

  // 1. Initial Load: Repositories, Active User, Sovereignty Stats
  const fetchGlobalMetadata = useCallback(async () => {
    try {
      const [reposRes, userRes, sovRes] = await Promise.all([
        fetch('/api/v1/repositories'),
        fetch('/api/v1/billing/subscription'),
        fetch('/api/v1/sovereignty/stats'),
      ]);

      if (reposRes.ok) {
        const reposData = await reposRes.json();
        setRepositories(reposData);
        if (reposData.length > 0 && !selectedRepoId) {
          setSelectedRepoId(reposData[0].forgejo_repo_id);
        }
      }
      if (userRes.ok) {
        const userData = await userRes.json();
        setCurrentUser(userData);
      }
      if (sovRes.ok) {
        const sovData = await sovRes.json();
        setBlockedBotsCount(sovData.blocked_count || 0);
      }
    } catch (err) {
      console.error('Error fetching global metadata:', err);
    }
  }, [selectedRepoId]);

  useEffect(() => {
    fetchGlobalMetadata();
  }, [fetchGlobalMetadata]);

  // Current active repository object
  const currentRepo = useMemo(() => {
    return (
      repositories.find((r) => r.forgejo_repo_id === selectedRepoId || r.id === selectedRepoId) ||
      repositories[0] ||
      null
    );
  }, [repositories, selectedRepoId]);

  // 2. Targeted Fetch: Snapshots & Worktree Status for Active Repo
  const fetchRepoSnapshots = useCallback(async (repoId) => {
    if (!repoId) return;
    try {
      const res = await fetch(`/api/v1/repositories/${repoId}/snapshots`);
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.snapshots || []);
      }
    } catch (err) {
      console.error('Error fetching snapshots:', err);
    }
  }, []);

  // 3. Targeted Fetch: Academic DOIs for Active Repo
  const fetchRepoDois = useCallback(async (repoId) => {
    if (!repoId) return;
    try {
      const res = await fetch(`/api/v1/repositories/${repoId}/dois`);
      if (res.ok) {
        const data = await res.json();
        setDois(data || []);
      }
    } catch (err) {
      console.error('Error fetching DOIs:', err);
    }
  }, []);

  // 4. Targeted Fetch: Untracked Slop for Active Repo
  const fetchRepoSlop = useCallback(async (repoId) => {
    if (!repoId) return;
    try {
      const res = await fetch(`/api/v1/repositories/${repoId}/slop`);
      if (res.ok) {
        const data = await res.json();
        setSlop(data || []);
      }
    } catch (err) {
      console.error('Error fetching slop:', err);
    }
  }, []);

  // 5. Targeted Fetch: Tasks for Active Repo
  const fetchRepoTasks = useCallback(async (repoId) => {
    if (!repoId) return;
    try {
      const res = await fetch(`/api/v1/repositories/${repoId}/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
    }
  }, []);

  // Refresh single repo details (e.g. after commit or rollback)
  const refreshActiveRepo = useCallback(async (repoId) => {
    if (!repoId) return;
    try {
      const res = await fetch(`/api/v1/repositories/${repoId}`);
      if (res.ok) {
        const updated = await res.json();
        setRepositories((prev) =>
          prev.map((r) => (r.forgejo_repo_id === updated.forgejo_repo_id ? updated : r))
        );
      }
    } catch (err) {
      console.error('Error refreshing repo:', err);
    }
  }, []);

  // Targeted data trigger when active repository or tab changes
  useEffect(() => {
    if (!currentRepo) return;
    const targetId = currentRepo.forgejo_repo_id;
    fetchRepoSnapshots(targetId);
    fetchRepoSlop(targetId);

    if (activeTab === 'zenodo') {
      fetchRepoDois(targetId);
    } else if (activeTab === 'kanban') {
      fetchRepoTasks(targetId);
    }
  }, [currentRepo, activeTab, fetchRepoSnapshots, fetchRepoSlop, fetchRepoDois, fetchRepoTasks]);

  // Emergency Hard Reset Action
  const handleRollback = useCallback(
    async (snapshotName) => {
      if (!currentRepo) return;
      setIsExecutingRollback(true);
      try {
        const res = await fetch('/api/v1/panic/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo_id: currentRepo.forgejo_repo_id,
            snapshot_name: snapshotName,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setRollbackOutcome(data);
          // Targeted updates: only active repo HEAD, snapshots, and slop
          await Promise.all([
            refreshActiveRepo(currentRepo.forgejo_repo_id),
            fetchRepoSnapshots(currentRepo.forgejo_repo_id),
            fetchRepoSlop(currentRepo.forgejo_repo_id),
          ]);
        }
      } finally {
        setIsExecutingRollback(false);
      }
    },
    [currentRepo, refreshActiveRepo, fetchRepoSnapshots, fetchRepoSlop]
  );

  const handleResetAll = useCallback(async () => {
    await fetch('/api/v1/state/reset', { method: 'POST' });
    setRollbackOutcome(null);
    await fetchGlobalMetadata();
    if (currentRepo) {
      fetchRepoSnapshots(currentRepo.forgejo_repo_id);
      fetchRepoSlop(currentRepo.forgejo_repo_id);
    }
  }, [fetchGlobalMetadata, currentRepo, fetchRepoSnapshots, fetchRepoSlop]);

  return (
    <div className="min-h-screen bg-[#070b19] text-slate-100 flex flex-col font-sans selection:bg-amber-500/20 selection:text-amber-200">
      <div role="status" className="px-6 py-2 bg-amber-950 text-amber-200 text-sm">Demo workspace — sample data. Billing, DOI publishing, and Git rollback are simulated. Workspace changes are saved on this server.</div>
      {/* Top Bar Header */}
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
          {[
            { id: 'panic_room', label: 'Panic Room Engine' },
            { id: 'zenodo', label: 'Zenodo Academic DOI' },
            { id: 'stripe', label: 'Stripe Monetization' },
            { id: 'sovereignty', label: 'Data Sovereignty' },
            { id: 'kanban', label: 'Kanban Board' },
            { id: 'source', label: 'Python Source' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                activeTab === tab.id
                  ? 'text-slate-100 border-amber-400 font-semibold'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Primary Action Button */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              if (snapshots.length > 0) {
                handleRollback(snapshots[0].sanitized_name);
              }
            }}
            disabled={isExecutingRollback || snapshots.length === 0}
            className="px-4 py-2 text-xs font-semibold text-rose-100 bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{isExecutingRollback ? 'Purging Slop...' : 'Emergency Hard Reset'}</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 py-8 space-y-8">
        {/* Workspace Sub-Header */}
        <section className="border-b border-slate-800/80 pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="text-xs font-mono text-slate-400 flex items-center gap-2 flex-wrap">
              <span>LaunchPadre Workspace</span>
              <span aria-hidden="true">·</span>
              <span>Targeted REST API Reads</span>
              <span aria-hidden="true">·</span>
              <span>Embedded SQLite Index Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100 font-display">
              LaunchPadre Developer Console
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Targeted per-resource reads backed by native SQLite B-tree indexes, non-blocking asynchronous file streaming, and zero hardcoded credentials.
            </p>
          </div>

          {/* Repository Selector Toolbar */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-[#0b132b] border border-slate-800 rounded-lg">
              {repositories.map((repo) => (
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
              onClick={handleResetAll}
              className="px-3 py-2 text-xs font-medium text-slate-300 bg-[#0b132b] border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset State</span>
            </button>
          </div>
        </section>

        {/* 4-Column Quantitative KPI Strip (Memoized) */}
        <MetricsStrip
          currentRepo={currentRepo}
          snapshotCount={snapshots.length}
          untrackedSlopCount={slop.length}
          blockedBotsCount={blockedBotsCount}
        />

        {/* Modular Tabs */}
        {activeTab === 'panic_room' && (
          <PanicRoomTab
            currentRepo={currentRepo}
            snapshots={snapshots}
            rollbackOutcome={rollbackOutcome}
            isExecutingRollback={isExecutingRollback}
            onRollback={handleRollback}
            onSnapshotCreated={() => {
              if (currentRepo) {
                refreshActiveRepo(currentRepo.forgejo_repo_id);
                fetchRepoSnapshots(currentRepo.forgejo_repo_id);
              }
            }}
            onSlopInjected={() => {
              if (currentRepo) {
                fetchRepoSlop(currentRepo.forgejo_repo_id);
              }
            }}
          />
        )}

        {activeTab === 'zenodo' && (
          <ZenodoTab
            currentRepo={currentRepo}
            dois={dois}
            onDoiMinted={() => {
              if (currentRepo) {
                fetchRepoDois(currentRepo.forgejo_repo_id);
              }
            }}
          />
        )}

        {activeTab === 'stripe' && (
          <StripeTab
            currentUser={currentUser}
            onUserPlanUpdated={() => {
              fetch('/api/v1/billing/subscription')
                .then((r) => r.json())
                .then(setCurrentUser);
            }}
          />
        )}

        {activeTab === 'sovereignty' && (
          <SovereigntyTab
            onProbeExecuted={() => {
              fetch('/api/v1/sovereignty/stats')
                .then((r) => r.json())
                .then((d) => setBlockedBotsCount(d.blocked_count || 0));
            }}
          />
        )}

        {activeTab === 'kanban' && <KanbanTab tasks={tasks} />}

        {activeTab === 'source' && <SourceViewerTab />}
      </main>
    </div>
  );
}

