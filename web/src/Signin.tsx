import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { residents } from './api';

export function Signin() {
  const [residentId, setResidentId] = useState('mina');
  const nav = useNavigate();

  return <main className="signin auth-page">
    <Link className="brand" to="/">◈ resolve</Link>
    <div className="auth-layout">
      <article className="auth-shell" aria-labelledby="signin-title">
        <div className="auth-inner">
          <div className="auth-heading">
            <span className="auth-badge">RESIDENT WORKSPACE</span>
            <h1 id="signin-title">Welcome back.</h1>
            <p>Stay up to date on your home’s maintenance.</p>
          </div>
          <form className="auth-form" onSubmit={event => event.preventDefault()} aria-describedby="auth-availability">
            <label htmlFor="signin-email">Email address</label>
            <div className="auth-input">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 5h18v14H3ZM3 5l9 8 9-8" /></svg>
              <input id="signin-email" type="email" placeholder="you@example.com" autoComplete="username" disabled />
            </div>
            <div className="auth-label-row"><label htmlFor="signin-password">Password</label><button type="button" className="auth-text-button" disabled>Reset password</button></div>
            <div className="auth-input">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V6a4 4 0 0 1 8 0v4" /></svg>
              <input id="signin-password" type="password" placeholder="Enter your password" autoComplete="current-password" disabled />
            </div>
            <button className="auth-submit" type="submit" disabled>Sign in</button>
            <p id="auth-availability" className="auth-availability">Account sign-in is coming soon. Explore the demo below.</p>
          </form>
          <div className="auth-demo">
            <div className="auth-divider"><span>Explore the resident demo</span></div>
            <form onSubmit={event => {
              event.preventDefault();
              sessionStorage.setItem('resident', residentId);
              nav('/app');
            }}>
              <label htmlFor="demo-resident">Demo resident</label>
              <select id="demo-resident" value={residentId} onChange={event => setResidentId(event.target.value)}>{residents.map(resident => <option value={resident.id} key={resident.id}>{resident.name} · Unit {resident.unit}</option>)}</select>
              <button className="auth-demo-submit" type="submit">Continue to workspace</button>
            </form>
          </div>
        </div>
        <div className="auth-footer">Need access? <a href="/#help">Visit our help section</a></div>
      </article>
      <p className="auth-footnote">Sample residents only. No password required for the demo.</p>
    </div>
  </main>;
}
