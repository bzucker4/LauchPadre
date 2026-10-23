import React, { useState } from 'react';
import { Award, ExternalLink } from 'lucide-react';

export const ZenodoTab = React.memo(function ZenodoTab({
  currentRepo,
  dois,
  onDoiMinted,
}) {
  const [doiTitle, setDoiTitle] = useState('LaunchPadre Core Engine — Reproducible Git Infrastructure');
  const [creatorName, setCreatorName] = useState('Elena Rostova');
  const [affiliation, setAffiliation] = useState('LaunchPadre Systems Research');
  const [doiDescription, setDoiDescription] = useState('Frozen research software code archive published via LaunchPadre.');
  const [isMintingDoi, setIsMintingDoi] = useState(false);
  const [mintedDoiResult, setMintedDoiResult] = useState(null);

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
        onDoiMinted();
      }
    } finally {
      setIsMintingDoi(false);
    }
  };

  return (
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
              {dois.length} registered
            </span>
          </div>

          <div className="space-y-3">
            {dois.length === 0 ? (
              <div className="py-12 px-4 text-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-400">
                No academic DOIs minted for this repository yet.
              </div>
            ) : (
              dois.map((entry) => (
                <div key={entry.id} className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-sm font-bold font-mono text-amber-300">{entry.doi}</span>
                      <h4 className="text-xs font-semibold text-slate-100 mt-0.5">{entry.title}</h4>
                      <p className="text-[11px] text-slate-400">
                        {entry.creator_name} ({entry.creator_affiliation})
                      </p>
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
  );
});
