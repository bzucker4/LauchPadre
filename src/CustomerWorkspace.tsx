import React, { useEffect, useState } from 'react';
type Repo = {id:string;name:string;created_at:string};
type Task = {id:string;title:string;status:string};
export default function CustomerWorkspace({onLogout}:{onLogout:()=>void}) {
  const [repos,setRepos]=useState<Repo[]>([]); const [selected,setSelected]=useState('');
  const [tasks,setTasks]=useState<Task[]>([]);const [name,setName]=useState('');const [title,setTitle]=useState('');const [error,setError]=useState('');
  async function request(url:string,options?:RequestInit) {const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options?.headers}});if(!r.ok)throw new Error(`Request failed (${r.status})`);return r.json();}
  async function loadRepos(){try {const data:Repo[]=await request('/api/customer/repositories');setRepos(data);if(!selected&&data.length)setSelected(data[0].id);}catch(e){setError(String(e));}}
  useEffect(()=>{void loadRepos();},[]);
  useEffect(()=>{if(selected)request(`/api/customer/repositories/${selected}/tasks`).then(setTasks).catch(e=>setError(String(e)));else setTasks([]);},[selected]);
  async function addRepo(e:React.FormEvent){e.preventDefault();try{const repo=await request('/api/customer/repositories',{method:'POST',body:JSON.stringify({name})});setName('');await loadRepos();setSelected(repo.id);}catch(e){setError(String(e));}}
  async function addTask(e:React.FormEvent){e.preventDefault();try{await request(`/api/customer/repositories/${selected}/tasks`,{method:'POST',body:JSON.stringify({title})});setTitle('');setTasks(await request(`/api/customer/repositories/${selected}/tasks`));}catch(e){setError(String(e));}}
  return <main style={{maxWidth:900,margin:'40px auto',padding:24,fontFamily:'system-ui'}}><header style={{display:'flex',justifyContent:'space-between'}}><h1>LauchPadre Workspace</h1><button onClick={async()=>{await fetch('/api/customer/logout',{method:'POST'});onLogout();}}>Log out</button></header>
  <p>Your private repositories and tasks</p>{error&&<p role="alert">{error}</p>}
  <form onSubmit={addRepo}><input aria-label="Repository name" value={name} onChange={e=>setName(e.target.value)} placeholder="New repository" required maxLength={120}/><button>Add repository</button></form>
  <h2>Repositories</h2><select aria-label="Select repository" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a repository</option>{repos.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
  {selected&&<><h2>Tasks</h2><form onSubmit={addTask}><input aria-label="Task title" value={title} onChange={e=>setTitle(e.target.value)} required maxLength={250} placeholder="New task"/><button>Add task</button></form><ul>{tasks.map(t=><li key={t.id}>{t.title} <select aria-label={`Status for ${t.title}`} value={t.status} onChange={async e=>{try{await request(`/api/customer/tasks/${t.id}`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});setTasks(await request(`/api/customer/repositories/${selected}/tasks`));}catch(err){setError(String(err));}}}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></li>)}</ul></>}
  </main>;
}
