import { useEffect, useId, useRef, useState } from 'react';
import type { Resident } from '../../shared/types';
import type { Theme } from './ThemeToggle';
import { Avatar } from './Avatar';

const icons = {
  profile: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  invite: 'M16 21v-2a6 6 0 0 0-12 0v2M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM20 8v6m-3-3h6',
  email: 'M3 5h18v14H3ZM3 5l9 8 9-8',
  message: 'M21 11a9 9 0 0 1-9 9H3l1.5-4A9 9 0 1 1 21 11Z',
  api: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  logout: 'M9 3H4v18h5m5-14 5 5-5 5m-6-5h13',
};

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]} /></svg>;
}

type Panel = 'profile' | 'settings' | 'email' | 'message';

export function ProfileMenu({ resident, theme, onThemeChange, onSignOut }: {
  resident: Resident;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onSignOut: () => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [recipient, setRecipient] = useState('');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpen(false); setInviteOpen(false); }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (panel) dialog.current?.showModal();
  }, [panel]);

  function showPanel(next: Panel) {
    setOpen(false);
    setInviteOpen(false);
    setRecipient('');
    setPreview(false);
    setPanel(next);
  }

  function closePanel() {
    dialog.current?.close();
  }

  return <div className="profile" ref={root}>
    <button ref={trigger} type="button" className="avatar" aria-label={`${resident.name}'s account menu`} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`} onClick={() => { setOpen(!open); setInviteOpen(false); }} onKeyDown={event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
      }
    }}><Avatar name={resident.name} /></button>
    {open && <div className="account-menu" id={`${id}-menu`} role="menu" aria-label="My account" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      if (event.key === 'Tab') { setOpen(false); setInviteOpen(false); }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      <div className="account-menu-heading"><b>{resident.name}</b><span>Unit {resident.unit} · My account</span></div>
      <button role="menuitem" onClick={() => showPanel('profile')}><Icon name="profile" />Profile</button>
      <button role="menuitem" onClick={() => showPanel('settings')}><Icon name="settings" />Settings</button>
      <div role="separator" className="account-menu-separator" />
      <button role="menuitem" aria-expanded={inviteOpen} aria-controls={`${id}-invite`} onClick={() => setInviteOpen(!inviteOpen)}><Icon name="invite" />Invite household members<span className="menu-chevron" aria-hidden="true">{inviteOpen ? '−' : '+'}</span></button>
      {inviteOpen && <div className="account-submenu" id={`${id}-invite`} role="group" aria-label="Invitation method">
        <button role="menuitem" onClick={() => showPanel('email')}><Icon name="email" />Email</button>
        <button role="menuitem" onClick={() => showPanel('message')}><Icon name="message" />Message</button>
      </div>}
      <button role="menuitem" disabled title="Available when the backend is connected"><Icon name="api" />API access<span className="menu-soon">Coming soon</span></button>
      <div role="separator" className="account-menu-separator" />
      <button role="menuitem" className="menu-destructive" disabled title="Account deletion requires a connected backend"><Icon name="delete" />Delete account</button>
      <button role="menuitem" onClick={onSignOut}><Icon name="logout" />Sign out</button>
      <p className="account-menu-note">Invitations and account deletion will be available when accounts are connected.</p>
    </div>}
    <dialog ref={dialog} className="account-dialog" aria-labelledby={`${id}-title`} onClose={() => { setPanel(null); trigger.current?.focus(); }}>
      <div className="account-dialog-heading">
        <h2 id={`${id}-title`}>{panel === 'profile' ? 'Resident profile' : panel === 'settings' ? 'Settings' : 'Invite a household member'}</h2>
        <button className="dialog-close" aria-label="Close" onClick={closePanel}>×</button>
      </div>
      {panel === 'profile' && <>
        <div className="profile-identity"><Avatar name={resident.name} /><div><b>{resident.name}</b><p>Unit {resident.unit}</p></div></div>
        <dl className="profile-fields"><dt>Resident name</dt><dd>{resident.name}</dd><dt>Apartment</dt><dd>Unit {resident.unit}</dd><dt>Account type</dt><dd>Demo resident</dd></dl>
        <p className="muted">Profile editing and household membership will be available when accounts are connected.</p>
      </>}
      {panel === 'settings' && <>
        <label htmlFor={`${id}-theme`}>Appearance</label>
        <select id={`${id}-theme`} value={theme} onChange={event => onThemeChange(event.target.value as Theme)}><option value="light">Light mode</option><option value="dark">Dark mode</option></select>
        <p className="muted">Your appearance preference is saved in this browser.</p>
      </>}
      {(panel === 'email' || panel === 'message') && <>
        <p>Invite someone who lives in Unit {resident.unit} to share access to household maintenance requests.</p>
        <p className="muted">Each member will have their own sign-in linked to the same household. This demo only previews invitations; nothing is sent.</p>
        <form onSubmit={event => { event.preventDefault(); setPreview(true); }}>
          <label htmlFor={`${id}-recipient`}>{panel === 'email' ? 'Email address' : 'Phone number'}</label>
          <input id={`${id}-recipient`} type={panel === 'email' ? 'email' : 'tel'} value={recipient} required onChange={event => { setRecipient(event.target.value); setPreview(false); }} placeholder={panel === 'email' ? 'name@example.com' : 'Phone number with country code'} />
          <button className="invite-preview-button" type="submit">Preview invitation</button>
        </form>
        {preview && <div className="notice" role="status"><b>Invitation preview · Not sent</b><p>To: {recipient}</p><p>{resident.name} invites you to join Unit {resident.unit} on Resolve to track and manage household maintenance requests.</p></div>}
      </>}
    </dialog>
  </div>;
}
