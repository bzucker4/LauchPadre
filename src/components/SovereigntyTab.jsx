import React, { useState } from 'react';

export const SovereigntyTab = React.memo(function SovereigntyTab({ onProbeExecuted }) {
  const [probeAgent, setProbeAgent] = useState('GPTBot/1.2 (+https://openai.com/gptbot)');
  const [probeOutcome, setProbeOutcome] = useState(null);
  const [isProbing, setIsProbing] = useState(false);

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
      onProbeExecuted();
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-2">
          <span className="text-xs font-mono text-amber-300">Layer A</span>
          <h3 className="text-base font-semibold text-slate-100">Dynamic robots.txt</h3>
          <p className="text-xs text-slate-400">
            Disallows GPTBot, ClaudeBot, Bytespider from indexing public source trees.
          </p>
          <a
            href="/robots.txt"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono text-amber-400 hover:underline inline-block pt-1"
          >
            View /robots.txt →
          </a>
        </div>
        <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-2">
          <span className="text-xs font-mono text-rose-400">Layer B</span>
          <h3 className="text-base font-semibold text-slate-100">User-Agent Interception</h3>
          <p className="text-xs text-slate-400">
            ASGI middleware terminates known scraper bots with flat 403 Forbidden.
          </p>
        </div>
        <div className="p-5 bg-[#0b132b] border border-slate-800 rounded-lg space-y-2">
          <span className="text-xs font-mono text-emerald-400">Layer C</span>
          <h3 className="text-base font-semibold text-slate-100">SEO Control Header</h3>
          <p className="text-xs text-slate-400">
            Injects X-Robots-Tag: noindex, nofollow, noarchive on outbound responses.
          </p>
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
            className="flex-1 px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-amber-400"
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
          <div
            className={`p-3 rounded border text-xs font-mono ${
              probeOutcome.decision === 'BLOCKED'
                ? 'bg-rose-950/20 border-rose-800 text-rose-200'
                : 'bg-emerald-950/20 border-emerald-800 text-emerald-200'
            }`}
          >
            HTTP {probeOutcome.status_code} · {probeOutcome.message}
          </div>
        )}
      </div>
    </section>
  );
});
