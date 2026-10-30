import React, { useState } from 'react';
import { AlertTriangle, ShieldCheck, RotateCcw } from 'lucide-react';

export const PanicRoomTab = React.memo(function PanicRoomTab({
  currentRepo,
  snapshots,
  rollbackOutcome,
  isExecutingRollback,
  onRollback,
  onSnapshotCreated,
  onSlopInjected,
}) {
  const [snapshotName, setSnapshotName] = useState('pre_assistant_refactor');
  const [snapshotNote, setSnapshotNote] = useState('Baseline checkpoint prior to autonomous agent session');
  const [error, setError] = useState('');
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentRepo || !snapshotName.trim()) return;

    setError('');
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
        onSnapshotCreated();
      } else { const result = await res.json(); setError(result.error || 'Snapshot failed'); }
    } catch { setError('Unable to reach the server'); } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleGenerateSlop = async () => {
    if (!currentRepo) return;
    await fetch('/api/v1/panic/slop/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_id: currentRepo.id }),
    });
    onSlopInjected();
  };

  return (
    <section className="space-y-6">
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {currentRepo?.mode === 'live' && <p className="p-3 border border-amber-700 text-amber-200">Live repository. Snapshots tag committed HEAD only. Commit your changes first. Rollback requires a completely clean worktree and preserves a recovery ref; no file cleanup is performed.</p>}
      {currentRepo?.is_unborn_head && currentRepo?.mode !== 'live' && (
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

      {rollbackOutcome?.recovery_ref && <p className="text-emerald-300 font-mono break-all">Previous HEAD retained at {rollbackOutcome.recovery_ref}</p>}
      {rollbackOutcome && (
        <div className="p-5 bg-rose-950/20 border border-rose-800/80 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-rose-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Rollback completed</span>
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
              <span className="text-slate-400 block">Untracked files removed:</span>
              <span className="text-rose-400 font-semibold">
                {rollbackOutcome.purged_untracked_count} items
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Snapshot Creator Card */}
        <div className="lg:col-span-5 bg-[#0b132b] border border-slate-800/90 rounded-lg p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 font-display">Create Haven Snapshot</h2>
            <p className="text-xs text-slate-400 mt-1">
              Forces an un-detached Git tag <code className="text-amber-300 font-mono">panic_room_launchpadre_&lt;name&gt;</code> pointing to current HEAD.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <label className="text-xs font-medium text-slate-300 block">Annotation Note</label>
              <input
                type="text"
                value={snapshotNote}
                onChange={(e) => setSnapshotNote(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-amber-400"
              />
            </div>

            <button
              type="submit"
              disabled={isCreatingSnapshot || !currentRepo || !snapshotName.trim()}
              className="w-full py-2.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isCreatingSnapshot ? 'Creating Snapshot...' : 'POST /api/v1/panic/snapshots'}
            </button>
          </form>

          {/* AI Slop Injection Test Box */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-200">Test Worktree File Slop</h3>
                <p className="text-[11px] text-slate-400">Simulate broken AI assistant output in repo</p>
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
            <h2 className="text-lg font-semibold text-slate-100 font-display">Safe Haven Checkpoints</h2>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {snapshots.length} snapshot(s)
            </span>
          </div>

          <div className="space-y-3">
            {snapshots.length === 0 ? (
              <div className="py-12 px-4 text-center border border-dashed border-slate-800 rounded-lg">
                <p className="text-xs text-slate-400">No snapshots generated yet.</p>
              </div>
            ) : (
              snapshots.map((snap) => (
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
                      onClick={() => onRollback(snap.sanitized_name)}
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
  );
});

