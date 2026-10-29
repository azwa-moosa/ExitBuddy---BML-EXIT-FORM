// Application shell: role-specific sidebar, header with the development user
// switcher, notification bell and light/dark toggle. Navigation is built from
// the current identity's PERMISSIONS (hiding a tab is for convenience only —
// the server checks every request).
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../lib/context.jsx';
import { fmtDateTime, initials } from '../lib/format.js';

const DASH_LABEL = { admin: 'System Overview', er: 'ER Dashboard', executive: 'Executive Dashboard', recruitment: 'Release Dashboard', audit: 'Audit Overview' };

// Five core functions: Staff Release → Exit Interview Form → ER Meeting →
// Meeting Remarks → Complete Exit. Everything else is oversight or admin.
export function hrNav(user, can) {
  const d = user?.dashboard;
  const has = (m, o) => can(m, o);
  return [
    ['Workspace', [
      ['/hr', DASH_LABEL[d] || 'Dashboard', 'home', true, true],
      ['/hr/releases/new', 'Initiate Release', 'send', has('releases', 'c')],
      ['/hr/releases', 'Staff Releases', 'list', has('releases', 'r'), true],
      ['/hr/cases', d === 'audit' ? 'Authorized Records' : has('cases', 'u') ? 'Exit Cases' : 'Exit Interview Status', 'file', has('cases', 'r'), true],
      ['/hr/meetings', 'ER Meetings', 'cal', has('meetings', 'r')],
    ]],
    ['Insights', [
      ['/hr/analytics', 'Analytics', 'chart', has('analytics', 'r')],
      ['/hr/reports', d === 'executive' ? 'Executive Reports' : 'Reports', 'print', has('reports', 'r')],
    ]],
    ['Administration', [
      ['/hr/admin/questionnaire', 'Exit Interview Questions', 'clipboard', has('questionnaire', 'r')],
      ['/hr/admin/users', 'Users & Roles', 'users', has('users', 'r')],
      ['/hr/admin/permissions', 'Permissions', 'shield', has('users', 'r')],
      ['/hr/admin/workflow', 'Workflow Settings', 'flow', has('config', 'r')],
      ['/hr/admin/integrations', 'Integration Settings', 'plug', has('integrations', 'r')],
      ['/hr/admin/settings', 'Application Settings', 'sliders', has('config', 'r')],
      ['/hr/notifications', 'Notification Centre', 'bell', true],
      ['/hr/audit', d === 'admin' ? 'Audit Logs' : d === 'audit' ? 'Audit Trail & Exports' : 'Audit Trail', 'history', has('audit', 'r')],
    ]],
  ].map(([g, items]) => [g, items.filter(i => i[3])]).filter(([, items]) => items.length);
}
export const EMPLOYEE_NAV = [['My release', [
  ['/me', 'My Release', 'home', true, true], ['/me/acknowledgement', 'Acknowledgement', 'check', true], ['/me/form', 'Exit Interview Form', 'file', true],
  ['/me/meeting', 'My Meeting', 'cal', true]]]];

function Switcher() {
  const { session, loadSession, toast, config } = useApp();
  const nav = useNavigate();
  const [ids, setIds] = useState(null);
  useEffect(() => { api('/dev/identities').then(setIds).catch(() => {}); }, [session]);
  if (!ids) return null;
  const i = session.identity;
  const value = i?.kind === 'employee' ? `e:${i.employee.employeeId}` : `u:${i?.user?.id}`;
  const change = async v => {
    try {
      await api('/dev/switch', { method: 'POST', body: v.startsWith('e:') ? { kind: 'employee', id: v.slice(2) } : { kind: 'user', id: Number(v.slice(2)) } });
      await loadSession(); nav(v.startsWith('e:') ? '/me' : '/hr'); toast('Switched user — simulated identity');
    } catch (e) { toast(e.message, 'error'); }
  };
  const name = i?.kind === 'employee' ? i.employee.name : i?.user?.name;
  return (
    <label className="who" title="Local development: switch user (no login)">
      <span className="avatar">{initials(name)}</span>
      <span className="sr-only">Acting as</span>
      <select value={value} onChange={e => change(e.target.value)} aria-label="Switch user">
        <optgroup label="People & Culture">{ids.users.filter(u => !u.persona).map(u => <option key={u.id} value={`u:${u.id}`}>{u.name} — {u.role}{u.viewOnly ? ' (view only)' : ''}</option>)}</optgroup>
        <optgroup label="Demo personas">{ids.users.filter(u => u.persona).map(u => <option key={u.id} value={`u:${u.id}`}>{u.name}</option>)}</optgroup>
        <optgroup label="Employees (demo, fictional)">{ids.employees.map(e => <option key={e.employee_id} value={`e:${e.employee_id}`}>Employee — {e.name} ({e.ref} · {config.statusLabels[e.status] || e.status})</option>)}</optgroup>
      </select>
    </label>
  );
}

function Bell() {
  const { user } = useApp();
  const [d, setD] = useState({ notifications: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const load = () => api('/notifications').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const f = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="iconbtn" aria-label={`Notifications, ${d.unread} unread`} onClick={() => { setOpen(!open); if (!open) load(); }}><Icon name="bell" size={17} />{d.unread > 0 && <span className="dot">{d.unread > 99 ? '99+' : d.unread}</span>}</button>
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <b>Notifications</b>
            <span className="row" style={{ gap: 6 }}>{d.unread > 0 && <button className="btn ghost sm" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); load(); }}>Mark all read</button>}<Link className="btn sm" to="/hr/notifications" onClick={() => setOpen(false)}>Open centre</Link></span>
          </div>
          {d.notifications.slice(0, 8).map(n => (
            <Link key={n.id} to={n.link || '/hr/notifications'} className={`n-item ${n.read_at ? '' : 'unread'}`} onClick={() => { setOpen(false); if (!n.read_at) api(`/notifications/${n.id}/read`, { method: 'POST' }).then(load); }}>
              <b>{n.title}</b><div className="muted">{n.body}</div><div className="tiny muted">{fmtDateTime(n.at)} · {n.channel} · {n.status}</div>
            </Link>
          ))}
          {!d.notifications.length && <p className="muted small" style={{ padding: 14 }}>Nothing yet.</p>}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useApp();
  const next = { system: 'light', light: 'dark', dark: 'system' }[theme];
  return <button className="iconbtn" onClick={() => setTheme(next)} aria-label={`Theme: ${theme}. Switch to ${next}`} title={`Theme: ${theme}`}><Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} size={17} /></button>;
}

export default function Shell() {
  const { session, config, user, can } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const i = session?.identity;
  const groups = i?.kind === 'employee' ? EMPLOYEE_NAV : hrNav(user, can);
  const who = i?.kind === 'employee' ? `${i.employee.name} · Employee` : user ? `${user.name} · ${user.role}` : '';
  return (
    <div className={`app ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <Link to={i?.kind === 'employee' ? '/me' : '/hr'} className="side-brand"><span className="brand-mark"><Icon name="door" size={18} /></span><span><b>{config.appName}</b><small>ExitBuddy · People &amp; Culture</small></span></Link>
        {groups.map(([g, items]) => (
          <div className="side-group" key={g}><span>{g}</span>
            {items.map(([to, label, icon, , end]) => <NavLink key={to} to={to} end={!!end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}><Icon name={icon} size={16} />{label}</NavLink>)}
          </div>
        ))}
        <div className="side-foot">{session?.devMode ? 'Local development · synthetic data · no login' : `Signed in via ${session?.authMode}`}</div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        {session?.devMode && <div className="devbar">Local development — no login. Simulated user; actions are marked “simulated”. Fictional data only.</div>}
        <header className="topbar">
          <div className="topbar-in">
            <button className="iconbtn menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" size={18} /></button>
            <span className="title small muted">{who}</span>
            <span className="spacer" />
            {session?.devMode && <Switcher />}
            {user && <Bell />}
            <ThemeToggle />
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
