import React from 'react';

export const MetricsStrip = React.memo(function MetricsStrip({
  currentRepo,
  snapshotCount,
  untrackedSlopCount,
  blockedBotsCount,
}) {
  return (
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
          repo: {currentRepo?.name} · {currentRepo?.default_branch || 'main'}
        </div>
      </div>

      <div className="p-4 bg-[#0b132b] border border-slate-800/90 rounded-lg">
        <div className="text-xs text-slate-400">Panic Haven Snapshots</div>
        <div className="mt-1 text-base font-semibold text-amber-300 font-mono tabular-nums">
          {snapshotCount} Checkpoints
        </div>
        <div className="mt-1 text-xs text-slate-400 font-mono launchpadre-tag">
          panic_room_launchpadre_*
        </div>
      </div>

      <div className="p-4 bg-[#0b132b] border border-slate-800/90 rounded-lg">
        <div className="text-xs text-slate-400">Untracked AI Slop in Worktree</div>
        <div
          className={`mt-1 text-base font-semibold font-mono tabular-nums ${
            untrackedSlopCount > 0 ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          {untrackedSlopCount} Dangling File(s)
        </div>
        <div className="mt-1 text-xs text-slate-400 font-mono">Purged via git clean -fd</div>
      </div>

      <div className="p-4 bg-[#0b132b] border border-slate-800/90 rounded-lg">
        <div className="text-xs text-slate-400">Data Sovereignty Shield</div>
        <div className="mt-1 text-base font-semibold text-slate-100 font-mono tabular-nums">
          {blockedBotsCount} Blocked AI Bots
        </div>
        <div className="mt-1 text-xs text-slate-400 font-mono">Layer B 403 Forbidden drops</div>
      </div>
    </section>
  );
});
