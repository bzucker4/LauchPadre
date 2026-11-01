import React, { useState } from 'react';

export const ZenodoTab = React.memo(function ZenodoTab({ currentRepo, dois, onDoiMinted }) {
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [description, setDescription] = useState('');
  const [license, setLicense] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prepare = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/academic/doi/mint', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_id: currentRepo?.forgejo_repo_id, title, creator_name: creator, description, license }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to prepare archive');
      onDoiMinted();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to connect'); }
    finally { setBusy(false); onDoiMinted(); }
  };
  const publish = async record => {
    if (!window.confirm(`Publish deposition ${record.deposition_id} on ${record.environment}? Confirm that you reviewed the committed archive, metadata, and license. Published deposits cannot be deleted through this workflow.`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/academic/doi/${record.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm_publication: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Publication failed');
      onDoiMinted();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to connect'); }
    finally { setBusy(false); onDoiMinted(); }
  };
  const inputClass = 'block w-full mt-1 rounded border border-slate-600 bg-slate-900 p-3';
  return <section className="space-y-6">
    <div className="rounded border border-slate-700 p-5 space-y-4">
      <h2 className="text-xl font-bold">Prepare a Zenodo software archive</h2>
      <p className="text-sm text-slate-400">Archives committed files from the selected live repository. Review those files for private information before uploading. Preparing creates an unpublished draft. Publication requires a separate confirmation. Sandbox is the default environment.</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <form onSubmit={prepare} className="space-y-4 max-w-xl">
        <label className="block">Software title<input required value={title} onChange={e => setTitle(e.target.value)} className={inputClass} /></label>
        <label className="block">Creator name<input required value={creator} onChange={e => setCreator(e.target.value)} className={inputClass} /></label>
        <label className="block">Description<textarea required value={description} onChange={e => setDescription(e.target.value)} className={inputClass} /></label>
        <label className="block">Zenodo license identifier<input required placeholder="Choose the license for this repository" value={license} onChange={e => setLicense(e.target.value)} className={inputClass} /></label>
        <button disabled={busy || currentRepo?.mode !== 'live'} className="rounded bg-amber-400 text-slate-950 px-4 py-3 font-semibold disabled:opacity-50">{busy ? 'Working…' : 'Prepare unpublished draft'}</button>
        {currentRepo?.mode !== 'live' && <p className="text-amber-300">Select a registered live repository to prepare an archive.</p>}
      </form>
    </div>
    <div className="space-y-4">
      {dois.map(record => <article key={record.id} className="rounded border border-slate-700 p-4 space-y-2">
        <h3 className="font-bold">{record.title}</h3>
        <p className="text-sm">{record.status || 'Sample DOI record'} · {record.environment || 'Demo'}</p>
        {record.environment && <a className="text-amber-300 underline" target="_blank" rel="noreferrer" href={`${record.environment}/deposit/${record.deposition_id}`}>Review deposition {record.deposition_id} on Zenodo</a>}
        {record.status === 'published' && <a className="block text-amber-300 underline" href={record.doi_url}>{record.doi}</a>}
        {['draft', 'publishing'].includes(record.status) && <button disabled={busy} onClick={() => publish(record)} className="block rounded border border-amber-500 px-4 py-2 disabled:opacity-50">{record.status === 'publishing' ? 'Check publication status' : 'Confirm publication…'}</button>}
        {record.status === 'upload_failed' && <p className="text-red-300">Upload incomplete. Prepare this same commit again to retry the saved draft.</p>}
      </article>)}
      {!dois.length && <p className="text-slate-400">No archives for this repository.</p>}
    </div>
  </section>;
});
