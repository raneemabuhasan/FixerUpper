import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, Navigate } from 'react-router-dom';
import { api, residents } from './api';
import type { Ticket } from '../../shared/types';
import './style.css';

function Landing() {
  const [done, setDone] = useState(!!sessionStorage.getItem('intro'));
  useEffect(() => {
    const timer = setTimeout(() => {
      setDone(true);
      sessionStorage.setItem('intro', '1');
    }, 2400);
    return () => clearTimeout(timer);
  }, []);
  return (<main className="landing">
    <header>
      <Link to="/" className="brand">◈ resolve</Link>
      <Link to="/signin">Resident sign in ↗</Link>
    </header>
    <section className="hero">
      <small>HOME MAINTENANCE, WITH FOLLOW-THROUGH</small>
      <h1>
        {['Report.', 'Track.', 'Resolve.'].map((w, i) => <span key={w} style={{ animationDelay: `${i * .45}s` }}>
          {w}</span>)}</h1>
      <p>A little less waiting.
        <br />
        A lot more peace of mind.</p>
      <div className={done ? 'actions' : 'actions waiting'}>
        <a className="button secondary" href="#how">How it works ↓</a>
        <Link className="button" to="/signin">Sign in ↗</Link>
      </div>
    </section>
    <footer>
      <span>YOUR HOME. YOUR VOICE. YOUR RESOLUTION.</span>
      <span>Built around you.</span>
    </footer>
    <section id="how">
      <small>A CLEARER PATH TO FIXED</small>
      <h2>From the first report
        <br />
        to the final “all good.”</h2>
      <div className="steps">
        {['Report your issue', 'Track every update', 'Confirm it’s fixed'].map((s, i) => <article key={s}>
          <small>0
            {i + 1}</small>
          <h3>
            {s}</h3>
          <p>
            {['Tell us what needs attention. We’ll help gather the details.', 'Keep your request, visit notes, and next steps in one place.', 'You decide whether the repair worked. Still broken? The case stays open.'][i]}</p>
        </article>)}</div>
    </section>
  </main>);
}

function Signin() {
  const [id, setId] = useState('mina');
  const nav = useNavigate();
  return (<main className="signin">
    <Link className="brand" to="/">◈ resolve</Link>
    <article className="card">
      <small>WELCOME HOME</small>
      <h1>Let’s get things sorted.</h1>
      <p>Enter the resident demo to explore your maintenance workspace.</p>
      <label>Demo resident
        <select value={id} onChange={e => setId(e.target.value)}>
          {residents.map(r => <option key={r.id} value={r.id}>
            {r.name}
            · Unit
            {r.unit}</option>)}</select>
      </label>
      <button onClick={() => {
        sessionStorage.setItem('resident', id);
        nav('/app');
      }}>Continue to dashboard ↗</button>
      <p className="muted">Synthetic residents only · No password required</p>
    </article>
  </main>);
}

function Workspace() {
  const nav = useNavigate();
  const { id } = useParams();
  const residentId = sessionStorage.getItem('resident');
  const resident = residents.find(r => r.id === residentId);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [stage, setStage] = useState(0);
  const path = window.location.pathname;
  async function load() {
    try {
      setError('');
      setTickets(await api.list(residentId!));
    }
    catch {
      setError('Could not load requests. Please retry.');
    }
    finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [residentId]);
  if (!resident)
    return <Navigate to="/signin" />;
  const selected = tickets.find(t => t.id === id);
  const matching = tickets.find(t => t.status !== 'resolved' && /faucet|drip/i.test(description) && /faucet/i.test(t.title));
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please retry.');
    }
    finally {
      setBusy(false);
    }
  }
  const list = tickets.filter(t => `${t.title} ${t.id}`.toLowerCase().includes(query.toLowerCase()));
  const ticketRows = (items: Ticket[]) => items.length ? items.map(t => <Link className="ticket" key={t.id} to={`/app/requests/${t.id}`}>
    <div>
      <small>
        {t.id}
        ·
        {t.category}</small>
      <h3>
        {t.title}</h3>
      <p>
        {t.nextAction}</p>
    </div>
    <span className={'badge ' + (t.status === 'resolved' ? 'green' : '')}>
      {t.status}</span>
    <span>↗</span>
  </Link>) :
    <p className="empty">No requests here. Your home is looking good.</p>;
  return (<div className="workspace">
    <aside>
      <Link to="/" className="logo">◈</Link>
      <Link to="/app">▦
        <span>Overview</span>
      </Link>
      <Link to="/app/requests">▤
        <span>My requests</span>
      </Link>
      <Link to="/app/new">＋
        <span>Report issue</span>
      </Link>
      <div className="sidebar-bottom">RESIDENT
        <br />
        WORKSPACE</div>
    </aside>
    <div className="workspace-body">
      <header>
        <strong>Resident workspace</strong>
        <input aria-label="Search requests" placeholder="⌕  Search your requests…" value={query} onChange={e => {
          setQuery(e.target.value);
          if (path !== '/app/requests')
            nav('/app/requests');
        }} />
        <Link className="button" to="/app/new">＋ New request</Link>
        <button className="avatar" title="Sign out" aria-label="Sign out" onClick={() => {
          sessionStorage.removeItem('resident');
          nav('/signin');
        }}>
          {resident.name[0]}</button>
      </header>
      <main className="content">
        {error &&
          <div role="alert" className="notice">
            {error}
            <button onClick={load}>Retry</button>
          </div>}
        {loading ?
          <p>Loading your workspace…</p>
          : path === '/app/new' ?
            <>
              <small>LET’S TAKE CARE OF IT</small>
              <h1>What needs attention?</h1>
              <p className="subtitle">Tell us a little about the issue. We’ll take it from there.</p>
              <section className="card intake">
                <span className="badge">Demo assistant · Scripted responses</span>
                <p>Hi
                  {resident.name}
                  ! What can we help you with today?</p>
                <label>Describe your issue
                  <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="The kitchen faucet keeps dripping…" />
                </label>
                {stage > 0 &&
                  <>
                    <p className="bubble">Where in your home is this happening?</p>
                    <label>Location
                      <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Kitchen sink" />
                    </label>
                  </>}
                {stage === 2 && matching ?
                  <div className="notice">
                    <h3>Could this be your existing request?</h3>
                    <p>
                      {matching.title}
                      ·
                      {matching.id}</p>
                    <button disabled={busy} onClick={() => act(async () => {
                      await api.link(matching.id, residentId!);
                      nav(`/app/requests/${matching.id}`);
                    })}>Yes, link to this request</button>
                    <button className="secondary" disabled={busy} onClick={() => act(async () => {
                      const t = await api.create(residentId!, description, location);
                      nav(`/app/requests/${t.id}`);
                    })}>No, this is a separate issue</button>
                  </div>
                  :
                  <button disabled={busy || !description.trim() || (stage > 0 && !location.trim())} onClick={() => {
                    if (stage === 0)
                      setStage(1);
                    else if (matching)
                      setStage(2);
                    else
                      act(async () => {
                        const t = await api.create(residentId!, description, location);
                        nav(`/app/requests/${t.id}`);
                      });
                  }}>
                    {busy ? 'Submitting…' : stage === 0 ? 'Continue →' : 'Submit request →'}</button>}</section>
            </>
            : id ? selected ?
              <>
                <Link to="/app/requests">← All requests</Link>
                <h1>
                  {selected.title}</h1>
                <p className="subtitle">
                  {selected.id}
                  ·
                  {selected.location}</p>
                <section className="card">
                  <span className="badge">
                    {selected.status}</span>
                  <h3>What happens next</h3>
                  <p>
                    {selected.nextAction}</p>
                  {selected.status === 'awaiting resident confirmation' &&
                    <div className="notice">
                      <h2>Did the repair work?</h2>
                      <p>A worker report is an update. Your confirmation closes the request.</p>
                      <button disabled={busy} onClick={() => act(() => api.confirm(selected.id, residentId!, true))}>Yes, resolved</button>
                      <button className="secondary" disabled={busy} onClick={() => act(() => api.confirm(selected.id, residentId!, false))}>No, still an issue</button>
                    </div>}</section>
                <section className="card">
                  <h2>Activity timeline</h2>
                  {selected.events.map((e, i) => <article className="event" key={i}>
                    <small>
                      {e.kind === 'worker' ? 'WORKER REPORT' : e.kind.toUpperCase()}
                      ·
                      {new Date(e.at).toLocaleString()}</small>
                    <p>
                      {e.text}</p>
                  </article>)}</section>
              </>
              :
              <h1>Request not found</h1>
              : path === '/app/requests' ?
                <>
                  <small>YOUR HOME, IN VIEW</small>
                  <h1>My requests</h1>
                  <p className="subtitle">Every update. Every next step. All together.</p>
                  <section className="card">
                    {ticketRows(list)}</section>
                </>
                :
                <>
                  <small>
                    {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    · UNIT
                    {resident.unit}</small>
                  <h1>Welcome home,
                    {resident.name}
                    .</h1>
                  <p className="subtitle">A little clarity for everything that needs care.</p>
                  <div className="dashboard-grid">
                    <section className="card">
                      <div className="card-heading">
                        <h2>Your requests</h2>
                        <Link to="/app/requests">View all ↗</Link>
                      </div>
                      <div className="count">
                        {tickets.filter(t => t.status !== 'resolved').length}
                        <span>open requests</span>
                      </div>
                      {ticketRows(tickets.slice(0, 3))}</section>
                    <section className="card attention">
                      <small>YOUR VOICE MATTERS</small>
                      <h2>A repair worth
                        <br />
                        a second look.</h2>
                      <p>Let us know if everything is working as it should.</p>
                      {tickets.filter(t => t.status === 'awaiting resident confirmation').map(t => <div key={t.id}>
                        <span className="badge">Awaiting your confirmation</span>
                        <h3>
                          {t.title}</h3>
                        <Link className="button" to={`/app/requests/${t.id}`}>Review repair →</Link>
                      </div>)}
                      {!tickets.some(t => t.status === 'awaiting resident confirmation') &&
                        <p>You’re all caught up.</p>}</section>
                    <section className="card activity">
                      <div className="card-heading">
                        <h2>Recent activity</h2>
                        <span className="muted">Keeping you in the loop</span>
                      </div>
                      {tickets.flatMap(t => t.events.map(e => ({ t, e }))).slice(-4).reverse().map(({ t, e }, i) => <Link className="event" key={i} to={`/app/requests/${t.id}`}>
                        <small>
                          {t.id}
                          ·
                          {e.kind === 'worker' ? 'Worker report' : 'Request update'}</small>
                        <p>
                          {e.text}</p>
                      </Link>)}</section>
                  </div>
                </>}</main>
    </div>
  </div>);
}
createRoot(document.getElementById('root')!).render(<BrowserRouter>
  <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/signin" element={<Signin />} />
    <Route path="/app" element={<Workspace />} />
    <Route path="/app/requests" element={<Workspace />} />
    <Route path="/app/new" element={<Workspace />} />
    <Route path="/app/requests/:id" element={<Workspace />} />
    <Route path="*" element={<Navigate to="/" />} />
  </Routes>
</BrowserRouter>);
