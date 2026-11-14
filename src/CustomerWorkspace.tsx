import React, { useEffect, useState } from 'react';
type Repo = {id:string;name:string;created_at:string};
type Task = {id:string;title:string;status:string};
type Offer = {plan:string;interval:string;name:string;cents:number};
const panel = 'rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6';
const field = 'min-w-0 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-amber-400';
const button = 'rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50';
const primary = 'rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50';

function Billing({ checkoutReturn }: { checkoutReturn: string | null }) {
  const [billing, setBilling] = useState<{plan:string;offers:Offer[]}>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setError('');
    try {
      const response = await fetch('/api/customer/billing/offers');
      if (!response.ok) throw new Error('Could not load billing');
      setBilling(await response.json());
    } catch { setError('Could not load billing. Try refreshing your plan.'); }
  }
  useEffect(() => { void refresh(); }, []);
  async function checkout(offer: Offer) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/customer/billing/checkout', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ plan: offer.plan, interval: offer.interval }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error || 'Could not start checkout'); return; }
      window.location.assign(result.url);
    } catch { setError('Could not start checkout'); }
    finally { setBusy(false); }
  }
  const current = billing?.plan === 'academic_tier' ? 'Academic Researcher' :
    billing?.plan === 'indie_solo' ? 'Indie Solo' : 'Free Developer';
  return (
    <section className={panel} aria-labelledby="subscription-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="subscription-title" className="text-xl font-semibold">Subscription</h2>
          <p className="mt-1 text-sm text-slate-300">
            {billing ? <>Current plan <strong className="ml-2 text-amber-300">{current}</strong></> : 'Loading plan…'}
          </p>
        </div>
        <button type="button" className={button} onClick={() => void refresh()}>Refresh plan</button>
      </div>
      {checkoutReturn === 'success' && <p role="status" className="mt-4 rounded-lg border border-blue-900 bg-blue-950/60 p-3 text-sm text-blue-200">You returned from Stripe. If your payment is still processing, refresh your plan to check its status.</p>}
      {checkoutReturn === 'canceled' && <p role="status" className="mt-4 text-sm text-slate-300">Checkout was canceled.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      {billing && !billing.offers.length && <p className="mt-4 text-sm text-slate-300">Test checkout is unavailable.</p>}
      {billing?.plan === 'free' && billing.offers.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Stripe sandbox plans</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {billing.offers.map(offer => (
              <button key={offer.plan + offer.interval} type="button" className="rounded-xl border border-slate-700 bg-slate-950 p-4 text-left hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50" disabled={busy} onClick={() => void checkout(offer)}>
                <span className="block font-semibold">{offer.name}</span>
                <span className="mt-1 block text-sm text-amber-300">${(offer.cents / 100).toFixed(2)} per {offer.interval}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
export default function CustomerWorkspace({onLogout,checkoutReturn}:{onLogout:()=>void;checkoutReturn:string|null}) {
  const [repos,setRepos]=useState<Repo[]>([]); const [selected,setSelected]=useState('');
  const [tasks,setTasks]=useState<Task[]>([]);const [name,setName]=useState('');const [title,setTitle]=useState('');const [error,setError]=useState('');
  async function request(url:string,options?:RequestInit) {const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options?.headers}});if(!r.ok)throw new Error(`Request failed (${r.status})`);return r.json();}
  async function loadRepos(){try {const data:Repo[]=await request('/api/customer/repositories');setRepos(data);if(!selected&&data.length)setSelected(data[0].id);}catch(e){setError(String(e));}}
  useEffect(()=>{void loadRepos();},[]);
  useEffect(()=>{if(selected)request(`/api/customer/repositories/${selected}/tasks`).then(setTasks).catch(e=>setError(String(e)));else setTasks([]);},[selected]);
  async function addRepo(e:React.FormEvent){e.preventDefault();try{const repo=await request('/api/customer/repositories',{method:'POST',body:JSON.stringify({name})});setName('');await loadRepos();setSelected(repo.id);}catch(e){setError(String(e));}}
  async function addTask(e:React.FormEvent){e.preventDefault();try{await request(`/api/customer/repositories/${selected}/tasks`,{method:'POST',body:JSON.stringify({title})});setTitle('');setTasks(await request(`/api/customer/repositories/${selected}/tasks`));}catch(e){setError(String(e));}}
  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">LauchPadre Workspace</h1>
        <button type="button" className={button} onClick={async () => { await fetch('/api/customer/logout', { method: 'POST' }); onLogout(); }}>Log out</button>
      </header>
      <Billing checkoutReturn={checkoutReturn} />
      {error && <p role="alert" className="rounded-lg border border-red-900 p-3 text-sm text-red-300">{error}</p>}
      <section className={panel} aria-labelledby="repositories-title">
        <h2 id="repositories-title" className="text-xl font-semibold">Repositories</h2>
        <form onSubmit={addRepo} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-sm font-medium">
            Repository name
            <input className={field + ' mt-2'} value={name} onChange={e => setName(e.target.value)} placeholder="New repository" required maxLength={120} />
          </label>
          <button className={primary}>Add repository</button>
        </form>
        {repos.length > 0 ? (
          <label className="mt-5 block text-sm font-medium">
            Select repository
            <select className={field + ' mt-2'} value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">Choose a repository</option>
              {repos.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
            </select>
          </label>
        ) : <p className="mt-4 text-sm text-slate-300">Add a repository to start tracking tasks.</p>}
      </section>
      {selected && (
        <section className={panel} aria-labelledby="tasks-title">
          <h2 id="tasks-title" className="text-xl font-semibold">Tasks</h2>
          <form onSubmit={addTask} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium">
              Task title
              <input className={field + ' mt-2'} value={title} onChange={e => setTitle(e.target.value)} required maxLength={250} placeholder="New task" />
            </label>
            <button className={primary}>Add task</button>
          </form>
          <ul className="mt-4 divide-y divide-slate-800">
            {tasks.map(task => (
              <li key={task.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-words">{task.title}</span>
                <select className={field + ' sm:w-40'} aria-label={`Status for ${task.title}`} value={task.status} onChange={async e => {
                  try {
                    await request(`/api/customer/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
                    setTasks(await request(`/api/customer/repositories/${selected}/tasks`));
                  } catch (err) { setError(String(err)); }
                }}>
                  <option value="todo">To do</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
