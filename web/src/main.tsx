import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { api, residents } from './api';
import type { Ticket } from '../../shared/types';
import './style.css';
import { RequestProgress } from './RequestProgress';
import { RequestList } from './RequestList';
import { RequestTabs } from './RequestTabs';
import { ProfileMenu } from './ProfileMenu';
import { Signin } from './Signin';
import { ActivityTimeline } from './ActivityTimeline';
import { getSavedTheme, ThemeToggle } from './ThemeToggle';
import type { Theme } from './ThemeToggle';

function Landing() {
  return (<main className="landing">
    <header>
      <Link to="/" className="brand">◈ resolve</Link>
      <nav className="landing-nav" aria-label="Main navigation">
        <a href="#how">How it works</a>
        <a href="#about">About</a>
        <a href="#help">Help</a>
        <Link className="button" to="/signin">Resident sign in</Link>
      </nav>
    </header>
    <section className="hero">
      <small>HOME MAINTENANCE, WITH FOLLOW-THROUGH</small>
      <h1>
        {['Report.', 'Track.', 'Resolve.'].map((w, i) => <span key={w} style={{ animationDelay: `${i * .45}s` }}>
          {w}</span>)}</h1>
      <p>A little less waiting.
        <br />
        A lot more peace of mind.</p>
    </section>

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
    <section id="about" className="landing-info">
      <small>ABOUT RESOLVE</small>
      <h2>Fixed means it works for you.</h2>
      <p>Resolve gives residents one place to report maintenance issues, follow updates, and confirm the repair worked. Every request keeps its details, activity, and next steps together.</p>
      <p>A worker’s completion report is the start of the final check. Your confirmation closes the request. If the issue persists, the request stays open for follow-up.</p>
    </section>
    <section id="help" className="landing-info">
      <small>A LITTLE HELP</small>
      <h2>Your questions, answered.</h2>
      <details>
        <summary>How do I report an issue?</summary>
        <p>Sign in to the resident demo, choose New request, and describe the issue. Add its location when prompted, then submit your request.</p>
      </details>
      <details>
        <summary>What if the repair didn’t work?</summary>
        <p>Open the request awaiting your confirmation and choose “No, still an issue.” It stays open, and the next step is for maintenance to review your feedback.</p>
      </details>
      <details>
        <summary>Where can I track my request?</summary>
        <p>Go to My requests in your resident workspace. Open a request to see its status, activity timeline, and what happens next.</p>
      </details>
      <details>
        <summary>Is this connected to my building?</summary>
        <p>This is a demo with sample residents and requests saved in your browser. It does not send reports to a real maintenance team.</p>
      </details>
    </section>
  </main>);
}

function Workspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestView = searchParams.get('view') === 'history' ? 'history' : 'current';
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  function changeTheme(next: Theme) {
    setTheme(next);
    try { localStorage.setItem('resolve-theme', next); } catch { /* Keep the current session usable. */ }
  }
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
  const matching = tickets.find(t => t.status !== 'resolved' && t.status !== 'cancelled' && /faucet|drip/i.test(description) && /faucet/i.test(t.title));
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
  const sorted = [...tickets].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const current = sorted.filter(t => t.status !== 'resolved' && t.status !== 'cancelled');
  const history = sorted.filter(t => t.status === 'resolved' || t.status === 'cancelled');
  const viewTickets = requestView === 'current' ? current : history;
  const list = viewTickets.filter(t => `${t.title} ${t.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const ticketRows = (items: Ticket[], emptyMessage = 'No current requests.') => items.length ? items.map(t => <Link className="ticket" key={t.id} to={`/app/requests/${t.id}`}>
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
  </Link>) :
    <p className="empty">{emptyMessage}</p>;
  return (<div className="workspace" data-theme={theme}>
    <aside>
      <Link to="/app" className="logo" aria-label="Resident overview">◈</Link>
      <NavLink to="/app" end>
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M5 2h2c.465 0 .697 0 .891.03A2.5 2.5 0 0 1 9.97 4.11c.03.193.03.425.03.89s0 .697-.03.891A2.5 2.5 0 0 1 7.89 7.97C7.697 8 7.465 8 7 8H5c-.465 0-.697 0-.891-.03A2.5 2.5 0 0 1 2.03 5.89C2 5.697 2 5.465 2 5s0-.697.03-.891A2.5 2.5 0 0 1 4.11 2.03C4.303 2 4.535 2 5 2m1 10c1.4 0 2.1 0 2.635.273a2.5 2.5 0 0 1 1.092 1.092C10 13.9 10 14.6 10 16v2c0 1.4 0 2.1-.273 2.635a2.5 2.5 0 0 1-1.092 1.092C8.1 22 7.4 22 6 22s-2.1 0-2.635-.273a2.5 2.5 0 0 1-1.093-1.092C2 20.1 2 19.4 2 18v-2c0-1.4 0-2.1.272-2.635a2.5 2.5 0 0 1 1.093-1.092C3.9 12 4.6 12 6 12M18 2c1.4 0 2.1 0 2.635.272a2.5 2.5 0 0 1 1.092 1.093C22 3.9 22 4.6 22 6v2c0 1.4 0 2.1-.273 2.635a2.5 2.5 0 0 1-1.092 1.092C20.1 12 19.4 12 18 12s-2.1 0-2.635-.273a2.5 2.5 0 0 1-1.092-1.092C14 10.1 14 9.4 14 8V6c0-1.4 0-2.1.273-2.635a2.5 2.5 0 0 1 1.092-1.093C15.9 2 16.6 2 18 2m-1 14h2c.465 0 .697 0 .891.03a2.5 2.5 0 0 1 2.078 2.079c.031.194.031.426.031.891s0 .697-.03.891a2.5 2.5 0 0 1-2.079 2.078C19.697 22 19.465 22 19 22h-2c-.465 0-.697 0-.891-.03a2.5 2.5 0 0 1-2.078-2.079C14 19.697 14 19.465 14 19s0-.697.03-.891a2.5 2.5 0 0 1 2.079-2.078C16.303 16 16.535 16 17 16" />
        </svg>
        <span>Overview</span>
      </NavLink>
      <NavLink to="/app/requests">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M13 5h9m-9 7h9m-9 7h9M2 17.286 3.875 19S6.164 15.8 8 15m-3.12-5h.24c1.008 0 1.512 0 1.897-.196a1.8 1.8 0 0 0 .787-.787C8 8.632 8 8.128 8 7.12v-.24c0-1.008 0-1.512-.196-1.897a1.8 1.8 0 0 0-.787-.787C6.632 4 6.128 4 5.12 4h-.24c-1.008 0-1.512 0-1.897.196a1.8 1.8 0 0 0-.787.787C2 5.368 2 5.872 2 6.88v.24c0 1.008 0 1.512.196 1.897a1.8 1.8 0 0 0 .787.787C3.368 10 3.872 10 4.88 10" />
        </svg>
        <span>My requests</span>
      </NavLink>
      <div className="sidebar-bottom">
        <ThemeToggle theme={theme} onChange={changeTheme} />
        RESIDENT
        <br />
        WORKSPACE</div>
    </aside>
    <div className="workspace-body">
      <header>
        <div className="overview-meta workspace-date">
          <time dateTime={new Date().toLocaleDateString('en-CA')}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </time>
          <span className="unit-badge">Unit {resident.unit}</span>
        </div>
        <div className="search-field">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M18.144 18.15 22 22m-1.218-10.625c0 2.486-.99 4.871-2.75 6.63a9.4 9.4 0 0 1-13.281 0 9.367 9.367 0 0 1 0-13.26 9.4 9.4 0 0 1 13.28 0 9.37 9.37 0 0 1 2.75 6.63" />
          </svg>
        <input aria-label="Search requests" placeholder="Search your requests…" value={query} onChange={e => {
          setQuery(e.target.value);
          if (path !== '/app/requests')
            nav('/app/requests');
        }} />
        </div>
        {path !== '/app/new' && <Link className="button" to="/app/new">＋ New request</Link>}
        <ProfileMenu resident={resident} theme={theme} onThemeChange={changeTheme} onSignOut={() => {
          sessionStorage.removeItem('resident');
          nav('/', { replace: true });
        }} />
      </header>
      <main className={`content${path === '/app' ? ' overview-content' : ''}`}>
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
                  <RequestProgress status={selected.status} />
                  <h3>What happens next</h3>
                  <p>
                    {selected.nextAction}</p>
                  {selected.status === 'awaiting resident confirmation' &&
                    <div className="notice">
                      <h2>Did the repair work?</h2>
                      <p>A worker report is an update. Your confirmation closes the request.</p>
                      <button disabled={busy} onClick={() => act(() => api.confirm(selected.id, residentId!, true))}>Yes, resolved</button>
                      <button className="secondary" disabled={busy} onClick={() => act(() => api.confirm(selected.id, residentId!, false))}>No, still an issue</button>
                    </div>}
                  {selected.status !== 'resolved' && selected.status !== 'cancelled' &&
                    <button className="cancel-request" disabled={busy} onClick={() => {
                      if (window.confirm('Cancel this maintenance request? Your request will be closed and kept in your history.'))
                        act(() => api.cancel(selected.id, residentId!));
                    }}>Cancel request</button>}
                </section>
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
                  <h1>My requests</h1>
                  <RequestTabs value={requestView} counts={{ current: current.length, history: history.length }} onChange={view => {
                    const next = new URLSearchParams(searchParams);
                    if (view === 'history') next.set('view', 'history');
                    else next.delete('view');
                    setSearchParams(next, { replace: true });
                  }} />
                  <section className="card">
                    <div role="tabpanel" id={`panel-${requestView}`} aria-labelledby={`tab-${requestView}`} tabIndex={0} key={requestView}>
                      <RequestList itemKey={list.map(t => t.id).join(',')}>{ticketRows(list, query.trim() ? 'No requests match your search.' : requestView === 'history' ? 'No request history yet.' : 'No current requests.')}</RequestList>
                    </div>
                  </section>
                </>
                :
                <>
                  <h1>Welcome Back, {resident.name}</h1>
                  <div className="dashboard-grid">
                    <section className="card">
                      <div className="card-heading">
                        <h2>Your requests</h2>
                        <Link to="/app/requests">View all
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                            <path d="M2 12h20m-4.5 5s1.385-2.833 4.5-5c-3.115-2.167-4.5-5-4.5-5" />
                          </svg>
                        </Link>
                      </div>
                      <div className="count">
                        {current.length}
                        <span>open requests</span>
                      </div>
                      <RequestList itemKey={current.map(t => t.id).join(',')}>{ticketRows(current)}</RequestList></section>
                    <section className="card activity">
                      <div className="card-heading">
                        <h2>Recent activity</h2>
                        <span className="muted">Latest updates</span>
                      </div>
                      <div className="activity-list">
                        <ActivityTimeline tickets={tickets} />
                      </div></section>
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
