// Role dashboards. The variant comes from the role's `dashboard` setting
// (admin · er · executive · recruitment · audit); each panel loads only the
// data that role is allowed to read.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorBox, Kpi, Loading, StatusBadge } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { fmtDate, fmtDateTime, today } from '../../lib/format.js';

const greet = () => { const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Indian/Maldives' }).format(new Date())); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const first = n => String(n || '').split(' ')[0];

function useLoad(fn, deps = []) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const load = () => { setErr(null); fn().then(setD).catch(e => setErr(e.message)); };
  useEffect(load, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [d, err, load];
}
const Head = ({ title, sub, children }) => <div className="page-head"><div><h1>{title}</h1><p>{sub}</p></div>{children && <div className="btns">{children}</div>}</div>;

export default function Dashboard() {
  const { user } = useApp();
  const V = { admin: AdminDash, recruitment: RecruitmentDash, executive: ExecutiveDash, audit: AuditDash }[user?.dashboard] || ErDash;
  return <V />;
}

function RecruitmentDash() {
  const { user, can } = useApp();
  const [d, err, load] = useLoad(() => api('/releases'));
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!d) return <main><Loading /></main>;
  const s = d.stats;
  const pending = d.releases.filter(r => r.status === 'Released' && !r.withdrawn_at).slice(0, 8);
  return (
    <main>
      <Head title={`${greet()}, ${first(user.name)}`} sub="Release dashboard — initiate staff releases and track acknowledgements. Interview responses and ER notes are not visible to this role.">
        {can('releases', 'c') && <Link className="btn primary" to="/hr/releases/new"><Icon name="send" size={15} />Initiate release</Link>}
      </Head>
      <div className="grid g4">
        <Kpi icon="users" tone={1} value={s.active} label="Active releases" sub={`${s.total} in total`} />
        <Kpi icon="clock" tone={2} value={s.awaitingAck} label="Awaiting acknowledgement" sub="employee has not acknowledged" />
        <Kpi icon="check" tone={3} value={s.formsIn} label="Forms submitted" sub={`${s.closed} exits completed`} />
        <Kpi icon="alert" tone={4} value={s.noResponse + s.withdrawn} label="No response / withdrawn" sub={`${s.noResponse} no response · ${s.withdrawn} withdrawn`} />
      </div>
      <div className="grid g2" style={{ marginTop: 16, alignItems: 'start' }}>
        <section className="card"><div className="card-head"><div><h2>Pending acknowledgements</h2></div><Link className="btn sm" to="/hr/releases?view=pending">View all</Link></div>
          <div className="list">{pending.map(r => <Link key={r.id} className="item" to={`/hr/releases?open=${r.id}`}><span className="meta"><b>{r.name}</b><span><span className="mono">{r.ref}</span> · {r.division} · LWD {fmtDate(r.last_day)}</span></span><span className="end"><span className="tiny muted">Released {fmtDate(r.released_at)}</span></span></Link>)}
            {!pending.length && <Empty icon="check">All releases are acknowledged.</Empty>}</div></section>
        <section className="card"><div className="card-head"><div><h2>Recent releases</h2></div><Link className="btn sm" to="/hr/releases">Staff releases</Link></div>
          <div className="list">{d.releases.slice(0, 8).map(r => <Link key={r.id} className="item" to={`/hr/releases?open=${r.id}`}><span className="meta"><b>{r.name}</b><span><span className="mono">{r.ref}</span> · {r.job_title}</span></span><span className="end"><StatusBadge status={r.status} /></span></Link>)}
            {!d.releases.length && <Empty icon="send">No releases yet.</Empty>}</div></section>
      </div>
    </main>
  );
}

function ErDash() {
  const { user, can } = useApp();
  const [d, err, load] = useLoad(() => Promise.all([
    api('/cases'), can('meetings', 'r') ? api('/meetings') : Promise.resolve({ meetings: [] }),
  ]).then(([c, m]) => ({ ...c, meetings: m.meetings })));
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!d) return <main><Loading /></main>;
  const cs = d.cases; const t = today();
  const mine = cs.filter(c => c.assigned_to === d.me && !['Closed', 'Withdrawn', 'No response'].includes(c.status));
  const action = cs.filter(c => c.action).sort((a, b) => (b.action.startsWith('Overdue') - a.action.startsWith('Overdue')));
  const up = d.meetings.filter(m => m.status === 'Scheduled' && m.date >= t).slice(0, 6);
  const editor = can('cases', 'u');
  const urgent = a => /Overdue|Reminder|Reschedule|outcome/.test(a);
  return (
    <main>
      <Head title={`${greet()}, ${first(user.name)}`} sub={editor ? 'Form submitted → schedule the ER meeting → mark conducted → meeting remarks → Complete Exit' : 'Exit interview overview — view-only access'}>
        {editor && <Link className="btn" to="/hr/cases?view=action"><Icon name="alert" size={15} />Needs action</Link>}
      </Head>
      <div className="grid g4">
        <Kpi icon="inbox" tone={1} value={cs.filter(c => c.status === 'Submitted').length} label="Meetings to schedule" sub="form submitted" />
        <Kpi icon="cal" tone={2} value={cs.filter(c => c.status === 'Meeting scheduled').length} label="ER meetings scheduled" sub={`${up.length} upcoming`} />
        <Kpi icon="check" tone={4} value={cs.filter(c => c.status === 'Interviewed').length} label="Meeting conducted" sub="remarks / Complete Exit" />
        <Kpi icon="clock" tone={3} value={cs.filter(c => ['Released', 'Acknowledged', 'Form in progress'].includes(c.status)).length} label="Awaiting employee" sub={`${cs.filter(c => c.status === 'Closed').length} exits completed`} />
      </div>
      <div className="grid g2" style={{ marginTop: 16, alignItems: 'start' }}>
        <section className="card"><div className="card-head"><div><h2>{editor ? 'Needs action' : 'Open cases'}</h2><p>{editor ? `${mine.length} open case${mine.length === 1 ? '' : 's'} assigned to you` : 'Status of current exits'}</p></div><Link className="btn sm" to={editor ? '/hr/cases?view=action' : '/hr/cases'}>View all</Link></div>
          <div className="list">{(editor ? action : cs.filter(c => !['Closed', 'Withdrawn'].includes(c.status))).slice(0, 8).map(c => (
            <Link key={c.id} className="item" to={`/hr/cases/${c.id}`}><span className="meta"><b>{c.name}</b><span><span className="mono">{c.ref}</span> · {c.division}{c.assigned_to === d.me ? ' · assigned to you' : ''}</span></span>
              <span className="end">{c.action ? <span className={`chip ${urgent(c.action) ? 'amber' : 'brand'}`}>{c.action}</span> : <StatusBadge status={c.status} />}</span></Link>))}
            {!(editor ? action : cs).length && <Empty icon="check">Nothing waiting.</Empty>}</div></section>
        {can('meetings', 'r') ? <section className="card"><div className="card-head"><div><h2>Upcoming ER meetings</h2></div><Link className="btn sm" to="/hr/meetings">ER meetings</Link></div>
          <div className="list">{up.map(m => <Link key={m.id} className="item" to={`/hr/cases/${m.exit_id}`}><span className="meta"><b>{m.name}</b><span>{fmtDate(m.date)} · {m.time} · {m.mode} · {m.interviewer}</span></span></Link>)}
            {!up.length && <Empty icon="cal">No meetings booked.</Empty>}</div></section>
          : <section className="card"><div className="card-head"><div><h2>Recently completed</h2></div></div>
            <div className="list">{cs.filter(c => c.closed_at).sort((a, b) => b.closed_at.localeCompare(a.closed_at)).slice(0, 6).map(c => <Link key={c.id} className="item" to={`/hr/cases/${c.id}`}><span className="meta"><b>{c.name}</b><span><span className="mono">{c.ref}</span> · {c.division}</span></span><span className="end tiny muted">{fmtDate(c.closed_at)}</span></Link>)}</div></section>}
      </div>
    </main>
  );
}

function ExecutiveDash() {
  const { user, config, can } = useApp();
  const [o, err, load] = useLoad(() => api('/analytics/overview'));
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!o) return <main><Loading /></main>;
  const maxExits = Math.max(1, ...o.divisions.map(x => x.exits));
  return (
    <main>
      <Head title={`${greet()}, ${first(user.name)}`} sub={`Executive summary — aggregated figures only; no individual responses or ER notes.${o.privacy ? ` Groups under ${config.suppressBelow} forms are hidden.` : ''}`}>
        {can('reports', 'r') && <Link className="btn" to="/hr/reports"><Icon name="print" size={15} />Reports</Link>}
      </Head>
      <div className="grid g4">
        <Kpi icon="users" tone={1} value={o.exits} label="Exits" sub={`${o.forms} forms · ${o.responseRate ?? '—'}% response`} />
        <Kpi icon="check" tone={4} value={o.completed} label="Exits completed" sub={`${o.inProgress} with ER · ${o.pending} awaiting employee`} />
        <Kpi icon="star" tone={2} value={o.avgRating == null ? '—' : o.avgRating.toFixed(2)} label="Avg. overall rating" sub={`n = ${o.ratingN}${o.ratingInsufficient ? ' · insufficient data' : ''}`} />
        <Kpi icon="trend" tone={3} textual value={o.topReason?.reason || '—'} label="Top reason" sub={o.topReason ? `${o.topReason.count} mentions` : ''} />
      </div>
      <div className="grid g2" style={{ marginTop: 16, alignItems: 'start' }}>
        <section className="card"><div className="card-head"><div><h2>Exits by division</h2></div>{can('analytics', 'r') && <Link className="btn sm" to="/hr/analytics">Analytics</Link>}</div>
          <div className="bars">{o.divisions.slice(0, 10).map(x => <div className="bar" key={x.division}><span className="lbl">{x.division}</span><span className="trk"><i style={{ width: `${(x.exits / maxExits) * 100}%`, background: 'var(--brand)' }} /></span><span className="val">{x.exits}</span></div>)}</div>
          {!o.divisions.length && <Empty icon="chart">No data yet.</Empty>}</section>
        <section className="card"><div className="card-head"><div><h2>Top reasons</h2></div></div>
          <div className="bars">{o.reasons.slice(0, 8).map(r => <div className="bar" key={r.reason}><span className="lbl">{r.reason}</span><span className="trk"><i style={{ width: `${(r.count / Math.max(1, o.reasons[0].count)) * 100}%`, background: 'var(--brand)' }} /></span><span className="val">{r.count}</span></div>)}</div>
          {!o.reasons.length && <Empty icon="chart">No reasons yet.</Empty>}</section>
      </div>
    </main>
  );
}

function AdminDash() {
  const { user } = useApp();
  const [d, err, load] = useLoad(() => api('/admin/overview'));
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!d) return <main><Loading /></main>;
  const c = d.counts;
  return (
    <main>
      <Head title={`${greet()}, ${first(user.name)}`} sub="System overview — configuration, integrations, notifications and the audit trail">
        <Link className="btn" to="/hr/admin/settings"><Icon name="sliders" size={15} />Settings</Link>
      </Head>
      <div className={`banner ${d.mode.devMode ? 'warn' : 'info'}`} style={{ marginBottom: 16 }}><Icon name="shield" /><div><b>{d.mode.devMode ? 'Local development mode' : 'Production mode'}</b> — authentication: {d.mode.authMode}{d.mode.devMode ? ' (no login, simulated identities). This mode cannot start when NODE_ENV=production.' : ''}</div></div>
      <div className="grid g4">
        <Kpi icon="users" tone={1} value={c.users} label="Active users" sub={`${c.roles} roles · ${c.employees} HRIS records`} />
        <Kpi icon="file" tone={2} value={c.openCases} label="Open cases" sub={`${c.releases} releases in total`} />
        <Kpi icon="bell" tone={3} value={c.failedNotifications} label="Failed notifications" sub={`${c.notifications} simulated in total`} />
        <Kpi icon="plug" tone={4} value={c.failedIntegrations} label="Failed integration events" sub={`${c.integrationEvents} mock events`} />
      </div>
      <div className="grid g2" style={{ marginTop: 16, alignItems: 'start' }}>
        <section className="card"><div className="card-head"><div><h2>System and integration errors</h2></div></div>
          <div className="list">{d.recentFailures.map((f, i) => <Link key={i} className="item" to={f.kind === 'Notification' ? '/hr/notifications' : '/hr/admin/integrations'}><span className="meta"><b>{f.kind}: {f.what}</b><span>{f.error || 'Failed'} · {fmtDateTime(f.at)}</span></span><span className="end"><span className="chip red">Failed</span></span></Link>)}
            {!d.recentFailures.length && <Empty icon="check">No failures.</Empty>}</div></section>
        <section className="card"><h2 style={{ marginBottom: 10 }}>Configuration</h2>
          <dl className="kv">
            <dt>Questionnaire</dt><dd>{d.questionnaire?.name || '—'}</dd>
            <dt>Database</dt><dd>{d.database.file} · {d.database.sizeKb} KB</dd>
            <dt>Migrations</dt><dd>{d.migrations.map(m => m.id).join(', ')}</dd>
            <dt>Audit entries</dt><dd>{c.auditEvents} · workflow events {c.workflowEvents} · digital records {c.digitalRecords}</dd>
            <dt>Node environment</dt><dd>{d.mode.nodeEnv}</dd>
          </dl>
          <div className="btns" style={{ marginTop: 12 }}><Link className="btn sm" to="/hr/admin/questionnaire">Exit interview questions</Link><Link className="btn sm" to="/hr/admin/users">Users &amp; roles</Link><Link className="btn sm" to="/hr/audit">Audit logs</Link></div>
        </section>
      </div>
    </main>
  );
}

function AuditDash() {
  const { user, can } = useApp();
  const [d, err, load] = useLoad(() => Promise.all([api('/audit?size=12'), api('/audit/workflow')]).then(([a, w]) => ({ a, w })));
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!d) return <main><Loading /></main>;
  return (
    <main>
      <Head title={`${greet()}, ${first(user.name)}`} sub="Audit overview — read-only. History tables are append-only and cannot be edited by anyone.">
        <Link className="btn" to="/hr/audit"><Icon name="history" size={15} />Audit trail &amp; exports</Link>
        {can('cases', 'r') && <Link className="btn" to="/hr/cases"><Icon name="file" size={15} />Authorized records</Link>}
      </Head>
      <div className="grid g3">
        <Kpi icon="history" tone={1} value={d.a.total} label="Audit entries" sub={`${d.a.users.length} actors`} />
        <Kpi icon="flow" tone={2} value={d.w.events.length >= 300 ? '300+' : d.w.events.length} label="Workflow events" sub="recent" />
        <Kpi icon="pen" tone={3} value={d.w.records.length >= 300 ? '300+' : d.w.records.length} label="Digital records" sub="acknowledgements and confirmations" />
      </div>
      <section className="card" style={{ marginTop: 16 }}><div className="card-head"><div><h2>Latest activity</h2></div></div>
        <div className="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Reference</th><th>Detail</th></tr></thead>
          <tbody>{d.a.entries.map(e => <tr key={e.id}><td className="small">{fmtDateTime(e.at)}</td><td className="small">{e.user_name}<div className="tiny muted">{e.role}</div></td><td><span className="chip">{e.action}</span>{e.simulated ? <span className="chip sim" style={{ marginLeft: 4 }}>Sim</span> : null}</td><td className="small mono">{e.ref || '—'}</td><td className="small">{e.detail}</td></tr>)}</tbody></table></div>
      </section>
    </main>
  );
}
