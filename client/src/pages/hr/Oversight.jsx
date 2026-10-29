// Notification Centre (mock Teams) and Audit Trail.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { DigitalRecords } from '../../components/Records.jsx';
import { eventLabel } from '../../components/Records.jsx';
import { Empty, ErrorBox, Loading, Pager, Tabs, usePaged } from '../../components/ui.jsx';
import { api, apiUrl, qs } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { fmtDateTime } from '../../lib/format.js';

const STATUS_CHIP = { Simulated: 'green', Failed: 'red', Pending: 'amber' };

export function NotificationCentre() {
  const { can, toast } = useApp();
  const [scope, setScope] = useState('mine');
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [status, setStatus] = useState(''); const [q, setQ] = useState('');
  const load = () => api(`/notifications${qs({ scope })}`).then(setD).catch(e => setErr(e.message));
  useEffect(() => { setD(null); load(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (d?.notifications || []).filter(n => (!status || n.status === status) && (!q || [n.title, n.body, n.recipient_name, n.ref, n.event].join(' ').toLowerCase().includes(q.toLowerCase())));
  const pg = usePaged(list, 20);
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  const tabs = [['mine', 'My notifications'], ...(can('notifications', 'r') ? [['all', 'All notifications'], ['rules', 'Rules & delivery']] : [])];
  return (
    <main>
      <div className="page-head"><div><h1>Notification centre</h1><p>Microsoft Teams delivery is <b>simulated</b> — notifications are recorded here and marked “Simulated”; nothing is sent to Teams until the Microsoft Graph integration is approved and configured.</p></div>
        {scope === 'mine' && d?.unread > 0 && <button className="btn" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); load(); }}>Mark all read</button>}</div>
      <Tabs tabs={tabs} value={scope} onChange={setScope} />
      {scope === 'rules' ? <Rules /> : !d ? <Loading /> : <>
        <div className="row" style={{ margin: '12px 0' }}>
          <input type="search" aria-label="Search notifications" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <select aria-label="Delivery status" value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 200 }}><option value="">All statuses</option><option>Simulated</option><option>Failed</option><option>Pending</option></select>
        </div>
        {list.length ? <div className="tablewrap"><table>
          <thead><tr><th>When</th>{scope === 'all' && <th>Recipient</th>}<th>Event</th><th>Message</th><th>Channel</th><th>Delivery</th><th /></tr></thead>
          <tbody>{pg.slice.map(n => (
            <tr key={n.id} className={!n.read_at && scope === 'mine' ? 'unread' : ''}>
              <td className="small">{fmtDateTime(n.at)}</td>
              {scope === 'all' && <td className="small">{n.recipient_name}<div className="tiny muted">{n.recipient_role}{n.detail_level === 'summary' ? ' · summary only' : ''}</div></td>}
              <td className="small"><code>{n.event}</code>{n.ref && <div className="tiny muted mono">{n.ref}</div>}</td>
              <td className="small"><b>{n.title}</b><div className="muted">{n.body}</div></td>
              <td className="small">{n.channel}<div className="tiny muted">{n.provider}</div></td>
              <td><span className={`chip ${STATUS_CHIP[n.status] || ''}`}>{n.status}</span><div className="tiny muted">{n.attempts} attempt{n.attempts === 1 ? '' : 's'}{n.delivered_at ? ` · ${fmtDateTime(n.delivered_at)}` : ''}</div>{n.last_error && <div className="tiny" style={{ color: 'var(--red)' }}>{n.last_error}</div>}</td>
              <td><div className="btns">
                {n.link && n.audience !== 'employee' && <Link className="btn ghost sm" to={n.link} onClick={() => !n.read_at && scope === 'mine' && api(`/notifications/${n.id}/read`, { method: 'POST' })}>Open</Link>}
                {n.status === 'Failed' && can('notifications', 'u') && <button className="btn sm" onClick={async () => { try { const r = await api(`/notifications/${n.id}/retry`, { method: 'POST' }); toast(r.notification.status === 'Failed' ? 'Retry failed again (simulated)' : 'Delivered (simulated)', r.notification.status === 'Failed' ? 'error' : undefined); load(); } catch (e) { toast(e.message, 'error'); } }}><Icon name="refresh" size={13} />Retry</button>}
              </div></td>
            </tr>))}</tbody></table></div> : <Empty icon="bell">No notifications.</Empty>}
        <Pager {...pg} />
      </>}
    </main>
  );
}

function Rules() {
  const { can, toast } = useApp();
  const [d, setD] = useState(null); const [roles, setRoles] = useState([]); const [s, setS] = useState(null);
  const load = () => Promise.all([api('/notifications?scope=all'), can('users', 'r') ? api('/roles') : Promise.resolve({ roles: [] }), can('config', 'r') ? api('/settings') : Promise.resolve(null)])
    .then(([n, r, st]) => { setD(n.rules.map(x => ({ ...x, recipients: x.recipients.map(y => ({ ...y })) }))); setRoles(r.roles); setS(st?.settings.notifications || { mockFailureRate: 0, maxAttempts: 3 }); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !s) return <Loading />;
  const ro = !can('notifications', 'u');
  const roleName = id => roles.find(r => r.id === id)?.name || `Role ${id}`;
  const who = rc => rc.type === 'role' ? roleName(rc.roleId) : { employee: 'The employee', assignee: 'Assigned ER officer', interviewer: 'Meeting ER officer', participants: 'Meeting participants' }[rc.type];
  const setRule = (i, p) => setD(d.map((r, k) => k === i ? { ...r, ...p } : r));
  const save = async () => { try { await api('/notification-settings', { method: 'PUT', body: { mockFailureRate: s.mockFailureRate, maxAttempts: s.maxAttempts, rules: d } }); toast('Notification settings saved'); load(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <section className="card"><div className="card-head"><div><h2>Mock delivery</h2><p>Use a failure rate above 0 to test failures and retries.</p></div>{!ro && <button className="btn primary sm" onClick={save}><Icon name="check" size={14} />Save</button>}</div>
        <div className="fields">
          <label className="field">Simulated failure rate (0–1)<input type="number" min="0" max="1" step="0.1" disabled={ro} value={s.mockFailureRate} onChange={e => setS({ ...s, mockFailureRate: Number(e.target.value) })} /></label>
          <label className="field">Maximum attempts<input type="number" min="1" max="10" disabled={ro} value={s.maxAttempts} onChange={e => setS({ ...s, maxAttempts: Number(e.target.value) })} /></label>
        </div></section>
      <section className="card"><div className="card-head"><div><h2>Who is notified</h2><p>“Summary” recipients get counts and status without confidential detail.</p></div></div>
        <div className="tablewrap"><table><thead><tr><th>Event</th><th>On</th><th>Recipients</th></tr></thead>
          <tbody>{d.map((r, i) => (
            <tr key={r.event}><td><b className="small">{r.label}</b><div className="tiny muted"><code>{r.event}</code></div></td>
              <td><input type="checkbox" aria-label={`${r.label} enabled`} disabled={ro} checked={r.enabled !== false} onChange={e => setRule(i, { enabled: e.target.checked })} /></td>
              <td><div className="row" style={{ gap: 6 }}>{r.recipients.map((rc, k) => (
                <span key={k} className="chip">{who(rc)}{!['employee', 'participants'].includes(rc.type) && <button className="linkbtn" disabled={ro} title="Toggle full / summary" onClick={() => setRule(i, { recipients: r.recipients.map((x, j) => j === k ? { ...x, detail: x.detail === 'summary' ? 'full' : 'summary' } : x) })}>· {rc.detail === 'summary' ? 'summary' : 'full'}</button>}
                  {!ro && <button className="linkbtn" aria-label="Remove recipient" onClick={() => setRule(i, { recipients: r.recipients.filter((_, j) => j !== k) })}>×</button>}</span>))}
                {!ro && <select aria-label="Add recipient" value="" onChange={e => { const v = e.target.value; if (!v) return; setRule(i, { recipients: [...r.recipients, v.startsWith('role:') ? { type: 'role', roleId: Number(v.slice(5)), detail: 'full' } : { type: v, detail: 'full' }] }); }} style={{ maxWidth: 170 }}>
                  <option value="">+ Add…</option><option value="employee">The employee</option><option value="assignee">Assigned ER officer</option><option value="interviewer">Meeting ER officer</option><option value="participants">Meeting participants</option>{roles.map(x => <option key={x.id} value={`role:${x.id}`}>{x.name}</option>)}</select>}
              </div></td></tr>))}</tbody></table></div>
      </section>
    </div>
  );
}

export function AuditTrail() {
  const [tab, setTab] = useState('audit');
  return (
    <main>
      <div className="page-head"><div><h1>Audit trail</h1><p>Every view of confidential responses, change, export and print is recorded. These tables are append-only — the database refuses edits and deletions. Times shown in Maldives time; exports are UTC.</p></div></div>
      <Tabs tabs={[['audit', 'Audit log'], ['workflow', 'Workflow history'], ['records', 'Digital records']]} value={tab} onChange={setTab} />
      <div style={{ marginTop: 12 }}>{tab === 'audit' ? <AuditLog /> : <WorkflowLog records={tab === 'records'} />}</div>
    </main>
  );
}
function AuditLog() {
  const [f, setF] = useState({ q: '', user: '', module: '', action: '', from: '', to: '', page: 1 });
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { const t = setTimeout(() => api(`/audit${qs({ ...f, size: 50 })}`).then(setD).catch(e => setErr(e.message)), 200); return () => clearTimeout(t); }, [f]);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  const set = p => setF({ ...f, ...p, page: 1 });
  const pages = Math.max(1, Math.ceil(d.total / d.size));
  return (
    <>
      <div className="card flat" style={{ marginBottom: 12 }}><div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <label className="field">Search<input type="search" value={f.q} onChange={e => set({ q: e.target.value })} placeholder="Reference, detail…" /></label>
        <label className="field">User<select value={f.user} onChange={e => set({ user: e.target.value })}><option value="">All</option>{d.users.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="field">Area<select value={f.module} onChange={e => set({ module: e.target.value })}><option value="">All</option>{d.modules.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="field">Action<select value={f.action} onChange={e => set({ action: e.target.value })}><option value="">All</option>{d.actions.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="field">From<input type="date" value={f.from} onChange={e => set({ from: e.target.value })} /></label>
        <label className="field">To<input type="date" value={f.to} onChange={e => set({ to: e.target.value })} /></label>
      </div>
        <div className="row between" style={{ marginTop: 10 }}><span className="small muted">{d.total} entries</span><a className="btn sm" href={apiUrl(`/audit.csv${qs({ ...f, page: '' })}`)}><Icon name="download" size={14} />Export CSV</a></div></div>
      {d.entries.length ? <div className="tablewrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Area</th><th>Action</th><th>Reference</th><th>Detail</th></tr></thead>
        <tbody>{d.entries.map(e => <tr key={e.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.at)}</td><td className="small">{e.user_name}<div className="tiny muted">{e.role}{e.actor_id ? <> · <span className="mono">{e.actor_id}</span></> : ''}</div></td><td className="small">{e.module || '—'}</td>
          <td><span className="chip">{e.action}</span>{e.simulated ? <span className="chip sim" style={{ marginLeft: 4 }}>Simulated</span> : null}</td><td className="small mono">{e.ref || '—'}</td><td className="small">{e.detail}</td></tr>)}</tbody></table></div> : <Empty icon="history">No entries match.</Empty>}
      <Pager page={f.page} pages={pages} setPage={p => setF({ ...f, page: p })} total={d.total} />
    </>
  );
}
function WorkflowLog({ records }) {
  const [q, setQ] = useState(''); const [d, setD] = useState(null);
  useEffect(() => { const t = setTimeout(() => api(`/audit/workflow${qs({ q })}`).then(setD).catch(() => setD({ events: [], records: [] })), 200); return () => clearTimeout(t); }, [q]);
  const list = d ? (records ? d.records : d.events) : [];
  const pg = usePaged(list, 25);
  return (
    <>
      <input type="search" aria-label="Search" placeholder="Search by reference, person or event…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
      {!d ? <Loading /> : records ? (<>
        <p className="small muted" style={{ marginBottom: 8 }}>Digital acknowledgement and confirmation records replace signature lines. They are system records with server timestamps — not legally equivalent to formal electronic signatures unless approved by the Bank.</p>
        {list.length ? <DigitalRecords records={pg.slice} showRef /> : <Empty icon="pen">No records.</Empty>}</>)
        : list.length ? <div className="tablewrap"><table>
          <thead><tr><th>When</th><th>Reference</th><th>Event</th><th>Status</th><th>By</th><th>Detail</th></tr></thead>
          <tbody>{pg.slice.map(e => <tr key={e.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.at)}</td><td className="small mono">{e.ref}</td><td className="small">{eventLabel(e.event)}</td>
            <td className="small">{e.from_status && e.from_status !== e.to_status ? `${e.from_status} → ` : ''}{e.to_status}</td>
            <td className="small">{e.actor_name}<div className="tiny muted">{e.actor_role}</div>{e.simulated ? <span className="chip sim">Simulated</span> : null}</td><td className="small">{e.detail}</td></tr>)}</tbody></table></div> : <Empty icon="flow">No events.</Empty>}
      <Pager {...pg} />
    </>
  );
}
