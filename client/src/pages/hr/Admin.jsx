// Administration: Users & Roles, Permissions, Workflow Settings, Integration
// Settings (mock OneUI / MiHCM / Teams) and Application Settings.
import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorBox, Loading, Modal, Pager, usePaged } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { fmtDateTime } from '../../lib/format.js';

const OPS = { c: 'Create', r: 'View', u: 'Edit', d: 'Delete' };
const DASH = { admin: 'System overview', er: 'ER dashboard', executive: 'Executive dashboard', recruitment: 'Release dashboard', audit: 'Audit overview' };

function useLoad(path) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const load = () => api(path).then(setD).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return [d, err, load];
}

// ---------------------------------------------------------------- users & roles
export function UsersRoles() {
  const { can, toast, confirm, loadSession, user: me } = useApp();
  const [u, errU, loadU] = useLoad('/users');
  const [r, errR, loadR] = useLoad('/roles');
  const [edit, setEdit] = useState(null);
  if (errU || errR) return <main><ErrorBox error={errU || errR} /></main>;
  if (!u || !r) return <main><Loading /></main>;
  const reload = () => { loadU(); loadR(); loadSession(); };
  const del = async x => { if (await confirm({ title: `Remove ${x.name}?`, body: 'Users linked to cases or notifications cannot be removed — deactivate them instead so the history stays complete.', confirmLabel: 'Remove', danger: true })) { try { await api(`/users/${x.id}`, { method: 'DELETE' }); toast('User removed'); reload(); } catch (e) { toast(e.message, 'error'); } } };
  return (
    <main>
      <div className="page-head"><div><h1>Users &amp; roles</h1><p>Who has which role. Access comes from the role’s permissions — never from a person’s name. In production, sign-in and role assignment come from Microsoft Entra ID (see the README).</p></div>
        {can('users', 'c') && <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" size={15} />Add user</button>}</div>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        {r.roles.map(role => (
          <section key={role.id} className="card">
            <div className="row between"><h3>{role.name}</h3>{role.system ? <span className="chip brand">Full access</span> : <span className="chip">{DASH[role.dashboard]}</span>}</div>
            <p className="tiny muted" style={{ margin: '4px 0 8px' }}>{role.description}</p>
            {role.members.map(m => <div key={m.id} className="small">{m.name}{m.persona ? <span className="chip" style={{ marginLeft: 4 }}>Demo persona</span> : null}{!m.active ? <span className="chip red" style={{ marginLeft: 4 }}>Inactive</span> : null}</div>)}
            {!role.members.length && <p className="small muted">No users</p>}
          </section>))}
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Role</th><th>Job title</th><th>Email (fictional)</th><th>Status</th><th /></tr></thead>
        <tbody>{u.users.map(x => (
          <tr key={x.id}><td><b>{x.name}</b>{x.persona ? <div className="tiny muted">Demo persona — fictional</div> : null}</td><td>{x.role}</td><td className="small">{x.title || '—'}</td><td className="small">{x.email}</td>
            <td>{x.active ? <span className="chip green">Active</span> : <span className="chip red">Inactive</span>}</td>
            <td><div className="btns">{can('users', 'u') && <button className="btn sm" onClick={() => setEdit(x)}><Icon name="edit" size={13} />Edit</button>}{can('users', 'd') && x.id !== me?.id && <button className="btn sm danger" aria-label={`Remove ${x.name}`} onClick={() => del(x)}><Icon name="trash" size={13} /></button>}</div></td></tr>))}</tbody>
      </table></div>
      {edit && <UserModal u={edit} roles={r.roles} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </main>
  );
}
function UserModal({ u, roles, onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: u.name || '', email: u.email || '', title: u.title || '', role_id: u.role_id || roles.find(r => r.name === 'Lead ER Officer')?.id || roles[0].id, active: u.active ?? 1 });
  const save = async e => { e.preventDefault(); try { await api(u.id ? `/users/${u.id}` : '/users', { method: u.id ? 'PUT' : 'POST', body: f }); toast(u.id ? 'User updated' : 'User added'); onDone(); } catch (x) { toast(x.message, 'error'); } };
  return (
    <Modal title={u.id ? `Edit ${u.name}` : 'Add user'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="uf">Save</button></>}>
      <form id="uf" className="stack" onSubmit={save}>
        <label className="field">Full name<input type="text" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Work email{u.id ? <input type="email" value={f.email} disabled /> : <input type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />}</label>
        <label className="field">Job title<input type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">Role<select value={f.role_id} onChange={e => setF({ ...f, role_id: Number(e.target.value) })}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {u.id && <label className="check"><input type="checkbox" checked={!!f.active} onChange={e => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Active</label>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- permissions matrix
export function Permissions() {
  const { can, toast, confirm, loadSession } = useApp();
  const [d, err, load] = useLoad('/roles');
  const [edit, setEdit] = useState({});
  const [newRole, setNewRole] = useState(false);
  if (err) return <main><ErrorBox error={err} /></main>;
  if (!d) return <main><Loading /></main>;
  const editable = can('users', 'u');
  const perm = role => edit[role.id]?.permissions || role.permissions;
  const toggle = (role, m, o) => {
    const p = JSON.parse(JSON.stringify(perm(role))); p[m] = p[m] || {};
    p[m][o] = !p[m][o];
    if (o === 'r' && !p[m].r) ['c', 'u', 'd'].forEach(x => delete p[m][x]);
    if (o !== 'r' && p[m][o] && d.modules.find(x => x.key === m).ops.includes('r')) p[m].r = true;
    setEdit({ ...edit, [role.id]: { ...edit[role.id], permissions: p } });
  };
  const save = async role => { try { await api(`/roles/${role.id}`, { method: 'PUT', body: edit[role.id] }); toast(`${role.name} updated`); const n = { ...edit }; delete n[role.id]; setEdit(n); load(); loadSession(); } catch (e) { toast(e.message, 'error'); } };
  const roles = d.roles;
  return (
    <main>
      <div className="page-head"><div><h1>Permissions</h1><p>Create · View · Edit · Delete per area and role. The server checks these on every request — hiding a menu item is only a convenience. Viewing an area is switched on automatically when create, edit or delete is on.</p></div>
        {can('users', 'c') && <button className="btn" onClick={() => setNewRole(true)}><Icon name="plus" size={15} />New role</button>}</div>
      <div className="tablewrap perm"><table>
        <thead><tr><th style={{ minWidth: 220 }}>Area</th>{roles.map(r => <th key={r.id} style={{ minWidth: 130 }}>{r.name}{edit[r.id] && <div><button className="btn primary sm" style={{ marginTop: 4 }} onClick={() => save(r)}>Save</button></div>}</th>)}</tr></thead>
        <tbody>
          <tr><td className="small"><b>Home dashboard</b></td>{roles.map(r => <td key={r.id}>{r.system || !editable ? <span className="small">{DASH[r.dashboard]}</span> : <select aria-label={`${r.name} dashboard`} value={edit[r.id]?.dashboard || r.dashboard} onChange={e => setEdit({ ...edit, [r.id]: { ...edit[r.id], dashboard: e.target.value } })}>{d.dashboards.map(x => <option key={x} value={x}>{DASH[x]}</option>)}</select>}</td>)}</tr>
          {d.modules.map(m => (
            <tr key={m.key}><td><b className="small">{m.label}</b><div className="tiny muted">{m.help}</div></td>
              {roles.map(r => <td key={r.id}><div className="ops">{m.ops.map(o => {
                const on = !!perm(r)[m.key]?.[o];
                return <label key={o} className={`op ${on ? 'on' : ''}`} title={`${OPS[o]} — ${m.label}`}><input type="checkbox" checked={on} disabled={!editable || !!r.system} onChange={() => toggle(r, m.key, o)} /><span>{OPS[o][0]}</span></label>;
              })}</div></td>)}</tr>))}
          <tr><td /> {roles.map(r => <td key={r.id}>{!r.system && can('users', 'd') && <button className="btn ghost sm danger" onClick={async () => { if (await confirm({ title: `Delete role ${r.name}?`, body: 'Only roles without users can be deleted.', confirmLabel: 'Delete', danger: true })) { try { await api(`/roles/${r.id}`, { method: 'DELETE' }); toast('Role deleted'); load(); } catch (e) { toast(e.message, 'error'); } } }}>Delete role</button>}</td>)}</tr>
        </tbody>
      </table></div>
      <p className="tiny muted" style={{ marginTop: 8 }}>C = Create · V = View · E = Edit · D = Delete. System Admin always has full access and cannot be changed.</p>
      {newRole && <RoleModal dashboards={d.dashboards} onClose={() => setNewRole(false)} onDone={() => { setNewRole(false); load(); }} />}
    </main>
  );
}
function RoleModal({ dashboards, onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', description: '', dashboard: 'er', permissions: {} });
  const save = async e => { e.preventDefault(); try { await api('/roles', { method: 'POST', body: f }); toast('Role created — set its permissions in the matrix'); onDone(); } catch (x) { toast(x.message, 'error'); } };
  return (
    <Modal title="New role" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="rf">Create</button></>}>
      <form id="rf" className="stack" onSubmit={save}>
        <label className="field">Role name<input type="text" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Description<input type="text" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
        <label className="field">Home dashboard<select value={f.dashboard} onChange={e => setF({ ...f, dashboard: e.target.value })}>{dashboards.map(x => <option key={x} value={x}>{DASH[x]}</option>)}</select></label>
        <p className="tiny muted">The role starts with no permissions.</p>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- settings helpers
function useSettings() {
  const { toast, loadConfig } = useApp();
  const [d, err, load] = useLoad('/settings');
  const save = async (body, msg = 'Settings saved') => { try { await api('/settings', { method: 'PUT', body }); toast(msg); await load(); await loadConfig(); return true; } catch (e) { toast(e.message, 'error'); return false; } };
  return [d?.settings, err, save];
}
const Num = ({ label, value, onChange, min = 0, max = 365, step = 1, disabled, help }) => <label className="field">{label}<input type="number" min={min} max={max} step={step} value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />{help && <small className="muted">{help}</small>}</label>;
const Toggle = ({ label, checked, onChange, disabled, help }) => <label className="switch" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span>{label}{help && <div className="tiny muted">{help}</div>}</span></label>;

export function WorkflowSettings() {
  const { can } = useApp();
  const [s, err, save] = useSettings();
  const [w, setW] = useState(null); const [staff, setStaff] = useState([]);
  useEffect(() => { if (s) setW({ ...s.workflow }); }, [s]);
  useEffect(() => { api('/users').then(d => setStaff(d.users.filter(u => u.active))).catch(() => {}); }, []);
  if (err) return <main><ErrorBox error={err} /></main>;
  if (!w) return <main><Loading /></main>;
  const ro = !can('config', 'u'); const set = p => setW({ ...w, ...p });
  return (
    <main>
      <div className="page-head"><div><h1>Workflow settings</h1><p>Release → Acknowledged → Form submitted → ER meeting scheduled → Meeting conducted → Meeting remarks → Exit completed.</p></div>
        {!ro && <button className="btn primary" onClick={() => save({ workflow: w })}><Icon name="check" size={15} />Save</button>}</div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="card stack"><h2>Acknowledgement</h2>
          <label className="field">Source of the acknowledgement<select disabled={ro} value={w.acknowledgementSource} onChange={e => set({ acknowledgementSource: e.target.value })}><option value="app">This application (employee acknowledges here)</option><option value="oneui">OneUI / ESS (acknowledgement arrives from OneUI)</option></select>
            <small className="muted">When OneUI is authoritative, employees are not asked to acknowledge twice — the app waits for the OneUI event.</small></label>
          <Toggle disabled={ro} label="Require acknowledgement before the form opens" checked={w.requireAcknowledgement} onChange={v => set({ requireAcknowledgement: v })} />
          <Num disabled={ro} label="Reminder after (days without acknowledgement / form)" value={w.reminderAfterDays} onChange={v => set({ reminderAfterDays: v })} />
          <Num disabled={ro} label="Mark “No response” this many days after the last working day" value={w.noResponseAfterLastDay} onChange={v => set({ noResponseAfterLastDay: v })} />
          <Num disabled={ro} label="Employee link valid until (days after last working day)" value={w.linkValidDaysAfterLastDay} onChange={v => set({ linkValidDaysAfterLastDay: v })} />
        </section>
        <section className="card stack"><h2>ER processing</h2>
          <label className="field">Default assignee for new releases<select disabled={ro} value={w.defaultAssigneeUserId || ''} onChange={e => set({ defaultAssigneeUserId: e.target.value ? Number(e.target.value) : null })}><option value="">Not assigned</option>{staff.filter(u => /ER/.test(u.role)).map(u => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</select></label>
          <Num disabled={ro} label="Overdue when no meeting this many days after submission" value={w.overdueAfterDays} onChange={v => set({ overdueAfterDays: v })} />
          <div className="banner info small"><Icon name="lock" size={16} /><div>The ER exit interview meeting is <b>mandatory</b>. An exit is completed by the ER officer after the meeting is conducted and its remarks are recorded — no approval step. A cancelled or no-show meeting never completes an exit.</div></div>
        </section>
      </div>
      {ro && <p className="small muted" style={{ marginTop: 10 }}>View only for your role.</p>}
    </main>
  );
}

export function AppSettings() {
  const { can, toast, confirm, loadSession, session } = useApp();
  const [s, err, save] = useSettings();
  const [f, setF] = useState(null); const [divText, setDivText] = useState('');
  useEffect(() => { if (s) { setF({ ...s }); setDivText(s.divisions.join('\n')); } }, [s]);
  if (err) return <main><ErrorBox error={err} /></main>;
  if (!f) return <main><Loading /></main>;
  const ro = !can('config', 'u'); const set = p => setF({ ...f, ...p });
  const divisions = [...new Set(divText.split('\n').map(x => x.trim()).filter(Boolean))];
  const submit = () => save({ appName: f.appName, companyName: f.companyName, orgName: f.orgName, brandTheme: f.brandTheme, timezone: f.timezone,
    minResponses: f.minResponses, suppressBelow: f.suppressBelow, divisions });
  const reset = async () => {
    const ok = await confirm({ title: 'Reset demo data?', body: 'Deletes everything in this local database and reloads the fictional demo data. Use only for testing.', confirmLabel: 'Reset demo data', danger: true, input: { label: 'Type RESET to confirm', required: true } });
    if (ok !== 'RESET') { if (ok) toast('Type RESET exactly', 'error'); return; }
    try { await api('/dev/reset', { method: 'POST' }); toast('Demo data reset'); await loadSession(); window.location.assign('/hr'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <main>
      <div className="page-head"><div><h1>Application settings</h1><p>Branding, time zone, analytics privacy and divisions.</p></div>
        {!ro && <button className="btn primary" onClick={submit}><Icon name="check" size={15} />Save</button>}</div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="card stack"><h2>Branding</h2>
          <label className="field">Application name<input type="text" disabled={ro} value={f.appName} onChange={e => set({ appName: e.target.value })} /></label>
          <label className="field">Company name (short)<input type="text" disabled={ro} value={f.companyName} onChange={e => set({ companyName: e.target.value })} /></label>
          <label className="field">Organisation name (printed documents)<input type="text" disabled={ro} value={f.orgName} onChange={e => set({ orgName: e.target.value })} /></label>
          <label className="field">Colour theme<select disabled={ro} value={f.brandTheme} onChange={e => set({ brandTheme: e.target.value })}><option value="teal">Teal (default)</option><option value="exitbuddy">ExitBuddy purple</option></select><small className="muted">Printed documents always use the Bank’s red and black.</small></label>
          <label className="field">Time zone for display<input type="text" disabled={ro} value={f.timezone} onChange={e => set({ timezone: e.target.value })} /><small className="muted">Times are stored in UTC by the server and shown in this zone (Indian/Maldives = MVT, UTC+5).</small></label>
        </section>
        <section className="card stack"><h2>Analytics</h2>
          <div className="fields">
            <Num disabled={ro} label="Minimum ratings for a reliable average" min={1} max={50} value={f.minResponses} onChange={v => set({ minResponses: v })} help="Fewer = “insufficient data”" />
            <Num disabled={ro} label="Hide divisions with fewer forms than" min={1} max={50} value={f.suppressBelow} onChange={v => set({ suppressBelow: v })} help="Privacy for small teams" />
          </div>
          <label className="field">Divisions — one per line (the controlled list used everywhere)<textarea rows={8} disabled={ro} value={divText} onChange={e => setDivText(e.target.value)} /></label>
        </section>
      </div>
      {session?.devMode && can('config', 'u') && (
        <section className="card" style={{ marginTop: 16, borderColor: 'var(--red)' }}>
          <h2>Demo data (local development only)</h2>
          <p className="small muted" style={{ margin: '6px 0 10px' }}>Restores the fictional demo records. Not available when the app runs in production.</p>
          <button className="btn danger" onClick={reset}><Icon name="refresh" size={15} />Reset demo data</button>
        </section>)}
    </main>
  );
}

// ---------------------------------------------------------------- integrations
const EXAMPLE = {
  MiHCM: { eventType: 'staff.release.initiated', employeeId: '', exitType: 'Resignation', noticeDate: '', lastWorkingDay: '', releaseId: '', initiatedBy: 'MiHCM workflow (simulated)' },
  OneUI: { eventType: 'staff.release.acknowledged', reference: '', releaseId: '' },
};
export function Integrations() {
  const { can, toast } = useApp();
  const [d, err, load] = useLoad('/integrations');
  const [f, setF] = useState(null); const [sim, setSim] = useState(null); const [show, setShow] = useState(null);
  const [filter, setFilter] = useState('');
  useEffect(() => { if (d) setF({ ...d.settings, acknowledgementSource: d.workflow.acknowledgementSource }); }, [d]);
  const events = (d?.events || []).filter(e => !filter || e.status === filter || e.system === filter);
  const pg = usePaged(events, 15);
  if (err) return <main><ErrorBox error={err} /></main>;
  if (!f) return <main><Loading /></main>;
  const ro = !can('integrations', 'u');
  const save = async () => {
    try { await api('/integrations', { method: 'PUT', body: f }); toast('Integration settings saved'); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const modeSel = sys => <select disabled={ro} value={f[sys].mode} onChange={e => setF({ ...f, [sys]: { ...f[sys], mode: e.target.value } })}><option value="mock">Mock (simulated)</option><option value="disabled">Disabled</option><option value="live" disabled>Live — not available until built, approved and configured</option></select>;
  return (
    <main>
      <div className="page-head"><div><h1>Integration settings</h1><p>OneUI / ESS, MiHCM and Microsoft Teams are <b>mock integrations</b>. No real endpoints, credentials or Microsoft permissions are configured. Payloads are proposals to be confirmed — see INTEGRATION_GUIDE.md.</p></div>
        {!ro && <button className="btn primary" onClick={save}><Icon name="check" size={15} />Save</button>}</div>
      <div className="grid g3" style={{ alignItems: 'start' }}>
        <section className="card stack"><h3><Icon name="plug" size={16} /> MiHCM (HRIS)</h3><label className="field">Mode{modeSel('mihcm')}</label><p className="tiny muted">{f.mihcm.note}. Proposed: MiHCM sends <code>staff.release.initiated</code>; the app creates the release.</p></section>
        <section className="card stack"><h3><Icon name="plug" size={16} /> OneUI / ESS</h3><label className="field">Mode{modeSel('oneui')}</label>
          <label className="field">Acknowledgement source<select disabled={ro} value={f.acknowledgementSource} onChange={e => setF({ ...f, acknowledgementSource: e.target.value })}><option value="app">This application</option><option value="oneui">OneUI (authoritative)</option></select></label>
          <Toggle disabled={ro} label="Send status updates to OneUI (outbound, mock)" checked={f.oneui.syncAcknowledgement} onChange={v => setF({ ...f, oneui: { ...f.oneui, syncAcknowledgement: v } })} /></section>
        <section className="card stack"><h3><Icon name="chat" size={16} /> Microsoft Teams</h3><label className="field">Mode{modeSel('teams')}</label><p className="tiny muted">{f.teams.note}. Notifications are recorded in the Notification Centre as <b>Simulated</b>; nothing is sent to Teams.</p></section>
      </div>
      <section className="card stack" style={{ marginTop: 16 }}><h3>Testing</h3>
        <Toggle disabled={ro} label="Simulate outbound integration failures" help="Outbound events fail and appear below for retry; administrators are notified." checked={f.simulateFailure} onChange={v => setF({ ...f, simulateFailure: v })} />
        <p className="tiny muted">Inbound endpoint: <code>POST /api/integrations/inbound/:system</code> with header <code>X-Integration-Key</code> {d.sharedSecretSet ? '(shared secret is set)' : '(disabled until INTEGRATION_SHARED_SECRET is set)'}. Repeated event IDs are ignored (idempotent).</p>
        {!ro && <div className="btns"><button className="btn sm" onClick={() => setSim('MiHCM')}>Simulate MiHCM release event</button><button className="btn sm" onClick={() => setSim('OneUI')}>Simulate OneUI acknowledgement</button></div>}
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h2>Integration events</h2><p>Inbound and outbound (mock). Failed events can be retried.</p></div>
          <select aria-label="Filter events" value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 180 }}><option value="">All</option><option>Failed</option><option>Rejected</option><option>Processed</option><option>Simulated</option><option>MiHCM</option><option>OneUI</option></select></div>
        {events.length ? <div className="tablewrap"><table>
          <thead><tr><th>When</th><th>Direction</th><th>System</th><th>Event</th><th>Reference</th><th>Status</th><th>Attempts</th><th /></tr></thead>
          <tbody>{pg.slice.map(e => <tr key={e.id}><td className="small">{fmtDateTime(e.at)}</td><td className="small">{e.direction}</td><td className="small">{e.system}</td><td className="small"><code>{e.event_type}</code></td><td className="small mono">{e.ref || '—'}</td>
            <td><span className={`chip ${/Failed|Rejected/.test(e.status) ? 'red' : /Processed|Simulated/.test(e.status) ? 'green' : ''}`}>{e.status}</span>{e.simulated ? <span className="chip sim" style={{ marginLeft: 4 }}>Mock</span> : null}{e.last_error && <div className="tiny muted">{e.last_error}</div>}</td>
            <td className="small">{e.attempts}</td>
            <td><div className="btns"><button className="btn ghost sm" onClick={() => setShow(e)}>Payload</button>{!ro && e.direction === 'outbound' && e.status === 'Failed' && <button className="btn sm" onClick={async () => { try { const r = await api(`/integrations/events/${e.id}/retry`, { method: 'POST' }); toast(r.ok ? 'Delivered (mock)' : 'Still failing', r.ok ? undefined : 'error'); load(); } catch (x) { toast(x.message, 'error'); } }}><Icon name="refresh" size={13} />Retry</button>}</div></td></tr>)}</tbody>
        </table></div> : <Empty icon="plug">No events.</Empty>}
        <Pager {...pg} />
      </section>
      {show && <Modal title={`${show.system} · ${show.event_type}`} onClose={() => setShow(null)}><pre className="code">{JSON.stringify(JSON.parse(show.payload || '{}'), null, 2)}</pre><p className="tiny muted">Proposed payload — field names to be confirmed with the {show.system} team.</p></Modal>}
      {sim && <SimModal system={sim} onClose={() => setSim(null)} onDone={() => { setSim(null); load(); }} />}
    </main>
  );
}
function SimModal({ system, onClose, onDone }) {
  const { toast } = useApp();
  const [txt, setTxt] = useState(JSON.stringify(EXAMPLE[system], null, 2));
  const [emps, setEmps] = useState([]);
  useEffect(() => { if (system === 'MiHCM') api('/employees').then(d => setEmps(d.employees.slice(0, 40))).catch(() => {}); }, [system]);
  const send = async () => {
    let payload; try { payload = JSON.parse(txt); } catch { toast('The payload is not valid JSON', 'error'); return; }
    try { const r = await api('/integrations/simulate', { method: 'POST', body: { system, payload } }); toast(r.duplicate ? 'Duplicate event ignored (idempotent)' : `Processed${r.ref ? ` — ${r.ref}` : ''}`); onDone(); }
    catch (e) { toast(e.message, 'error'); onDone(); }
  };
  const pick = id => { const p = JSON.parse(txt); const d = new Date(); d.setDate(d.getDate() + 21); setTxt(JSON.stringify({ ...p, employeeId: id, lastWorkingDay: d.toISOString().slice(0, 10), noticeDate: new Date().toISOString().slice(0, 10), releaseId: `MIHCM-SIM-${Date.now().toString().slice(-6)}`, eventId: `EVT-${Date.now().toString(36).toUpperCase()}` }, null, 2)); };
  return (
    <Modal wide title={`Simulate ${system} inbound event`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={send}><Icon name="send" size={15} />Send simulated event</button></>}>
      <div className="banner info small"><Icon name="plug" size={16} />Simulation only — the event is processed exactly like the inbound endpoint would, and marked as simulated. Send the same eventId twice to see duplicate handling — the second is ignored.</div>
      {system === 'MiHCM' && <label className="field">Fill with an employee (fictional HRIS)<select defaultValue="" onChange={e => e.target.value && pick(e.target.value)}><option value="">Choose…</option>{emps.map(e => <option key={e.employee_id} value={e.employee_id}>{e.employee_id} — {e.name} ({e.division})</option>)}</select></label>}
      {system === 'OneUI' && <p className="small muted">Fill in <code>reference</code> with a release awaiting acknowledgement (e.g. from Pending Acknowledgements).</p>}
      <label className="field">Payload (JSON)<textarea rows={12} className="code" value={txt} onChange={e => setTxt(e.target.value)} /></label>
    </Modal>
  );
}
