import React, { useState, useEffect } from 'react';
import { Copy, Check, Download, RefreshCw } from 'lucide-react';

const KNOWN_FILES = [
  'panic_room.py',
  'main.py',
  'models.py',
  'billing.py',
  'zenodo.py',
  'middleware.py',
  'schema.sql',
  'requirements.txt',
];

export const SourceViewerTab = React.memo(function SourceViewerTab() {
  const [activeFile, setActiveFile] = useState('panic_room.py');
  const [fileCache, setFileCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadFile() {
      if (fileCache[activeFile]) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/source/${activeFile}`);
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled) {
            setFileCache((prev) => ({ ...prev, [activeFile]: data.content }));
          }
        }
      } catch (err) {
        console.error('Failed to load source file', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    loadFile();
    return () => {
      isCancelled = true;
    };
  }, [activeFile, fileCache]);

  const currentContent = fileCache[activeFile] || '';

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const blob = new Blob([currentContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0b132b] border border-slate-800/90 rounded-lg p-4">
        <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
          {KNOWN_FILES.map((fileKey) => (
            <button
              key={fileKey}
              type="button"
              onClick={() => setActiveFile(fileKey)}
              className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeFile === fileKey
                  ? 'bg-slate-800 text-amber-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              backend_python/{fileKey}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!currentContent || loading}
            className="px-3 py-1.5 text-xs font-mono text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy {activeFile}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!currentContent || loading}
            className="px-3 py-1.5 text-xs font-mono text-slate-950 bg-amber-400 hover:bg-amber-300 font-semibold rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/70 text-xs font-mono text-slate-400 flex items-center justify-between">
          <span>/backend_python/{activeFile} · On-Demand Lazy Loaded (Async Cached)</span>
          {loading && (
            <span className="flex items-center gap-1 text-amber-400 text-[11px]">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Fetching async...</span>
            </span>
          )}
        </div>
        <pre className="p-5 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed max-h-[700px]">
          {loading && !currentContent ? '// Asynchronously reading from cache...' : currentContent}
        </pre>
      </div>
    </section>
  );
});
