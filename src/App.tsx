import React, { useEffect, useState } from 'react';
import CustomerWorkspace from './CustomerWorkspace';

export default function App() {
  const [ready,setReady]=useState(false);const [loggedIn,setLoggedIn]=useState(false);const [register,setRegister]=useState(false);
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');
  useEffect(()=>{fetch('/api/customer/me').then(r=>setLoggedIn(r.ok)).catch(()=>setError('Server unavailable')).finally(()=>setReady(true));},[]);
  const checkout = new URLSearchParams(window.location.search).get('checkout');
  const notice = checkout === 'success'
    ? 'You returned from Stripe. Sign in with the account that started checkout to check your subscription.'
    : checkout === 'canceled' ? 'Checkout was canceled. Sign in to return to your workspace.' : '';
  if(!ready)return <main style={{padding:48}}>Connecting…</main>;
  if(loggedIn)return <CustomerWorkspace checkoutReturn={checkout} onLogout={()=>setLoggedIn(false)}/>;
  async function submit(e:React.FormEvent){e.preventDefault();setError('');try{
    const body=JSON.stringify({email,password});const headers={'Content-Type':'application/json'};
    if(register){const created=await fetch('/api/customer/register',{method:'POST',headers,body});if(!created.ok)throw new Error('Registration failed');}
    const response=await fetch('/api/customer/login',{method:'POST',headers,body});if(!response.ok)throw new Error('Invalid credentials');
    setPassword('');setLoggedIn(true);
  }catch(err){setError(err instanceof Error?err.message:'Unable to sign in');}}
  return <main style={{maxWidth:440,margin:'12vh auto',padding:32,fontFamily:'system-ui',border:'1px solid #334155',borderRadius:16,background:'#101827'}}><h1 style={{fontSize:28,fontWeight:700}}>LauchPadre</h1><p>{register?'Create your customer account':'Sign in to your workspace'}</p>
    {notice && <p role="status" style={{margin:"16px 0",color:"#bfdbfe"}}>{notice}</p>}
    <form onSubmit={submit}><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" style={{display:'block',width:'100%',padding:12,margin:'8px 0 16px',background:'#070b19',border:'1px solid #64748b',borderRadius:8,color:'#f8fafc'}}/></label>
    <label>Password<input type="password" minLength={register?12:1} required value={password} onChange={e=>setPassword(e.target.value)} autoComplete={register?'new-password':'current-password'} style={{display:'block',width:'100%',padding:12,margin:'8px 0 16px',background:'#070b19',border:'1px solid #64748b',borderRadius:8,color:'#f8fafc'}}/></label>
    <button type="submit" style={{padding:"10px 16px",background:"#fbbf24",color:"#101827",borderRadius:8,fontWeight:600}}>{register?'Create account':'Sign in'}</button></form>
    {error&&<p role="alert">{error}</p>}<button style={{marginTop:16}} onClick={()=>{setRegister(!register);setError('');}}>{register?'Already have an account? Sign in':'Create an account'}</button>
  </main>;
}
