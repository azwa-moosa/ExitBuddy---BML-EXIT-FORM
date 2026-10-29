// Print-ready A4 documents in the Bank's red/black. Opens the browser print
// dialog — choose "Save as PDF" to file it. Handwritten signature lines are
// replaced by the system's digital acknowledgement records. These records are
// NOT treated as formal electronic signatures (see README → Digital records).
import { createRoot } from 'react-dom/client';
import { fillCompany, fmtDate, fmtDateTime, fmtTime, tzLabel } from '../lib/format.js';
import { isShown } from './Questions.jsx';

let root = null;
function printNode(node) {
  const el = document.getElementById('print-root');
  if (!root) root = createRoot(el);
  root.render(node);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 150);
}

const Cell = ({ l, v }) => <div><small>{l}</small>{v || '—'}</div>;
function Records({ records }) {
  return (
    <table className="pf"><thead><tr><th>Action</th><th>Recorded by</th><th>ID</th><th>Role</th><th>Date</th><th>Time ({tzLabel()})</th><th>Status</th></tr></thead>
      <tbody>{records.map((r, i) => <tr key={i}><td>{r.action}{r.comment ? ` — ${r.comment}` : ''}</td><td>{r.actor_name}</td><td>{r.actor_id || '—'}</td><td>{r.actor_role}</td><td>{fmtDate(r.at)}</td><td>{fmtTime(r.at)}</td>
        <td>{r.status}{r.simulated ? <span className="pf-sim"> (simulated)</span> : ''}</td></tr>)}</tbody></table>
  );
}

function CaseDoc({ c, config, opts, by }) {
  const qs = c.questionnaire?.questions || [];
  const a = c.answers || {};
  const val = q => {
    const v = a[q.code]; const opt = x => (q.options || []).find(o => o.value === x)?.label || x;
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'No answer';
    if (q.type === 'multi') return v.map(opt).join('; ');
    if (q.type === 'single' || q.type === 'choice') return opt(v);
    if (q.type === 'rating' || q.type === 'stars') return v === 'PNTS' ? 'Prefer not to say' : `${v} / 5`;
    return String(v);
  };
  const e = c.employee; const rl = c.release;
  return (
    <>
      <div className="pf-head"><div><div className="pf-org">{config.orgName} · People &amp; Culture · Employee Relations</div><h1>Exit Interview Record</h1></div>
        <div className="pf-ref">Reference<br /><b>{c.ref}</b><br />Generated {fmtDateTime(new Date().toISOString())}<br />by {by}</div></div>
      <div className="pf-sec">Employee</div>
      <div className="pf-grid"><Cell l="Name" v={e.name} /><Cell l="Employee ID" v={e.employee_uid} /><Cell l="Job title" v={e.job_title} />
        <Cell l="Division / department" v={[e.division, e.department].filter(Boolean).join(' · ')} /><Cell l="Exit type" v={rl.exit_type} /><Cell l="Last working day" v={fmtDate(rl.last_day)} />
        <Cell l="Release acknowledged" v={rl.acknowledged_at ? fmtDateTime(rl.acknowledged_at) : 'Not acknowledged'} /><Cell l="Form submitted" v={c.submitted_at ? fmtDateTime(c.submitted_at) : 'Not submitted'} />
        <Cell l="ER officer" v={c.assignee?.name} /><Cell l="Exit completion date" v={c.closed_at ? fmtDateTime(c.closed_at) : 'Not completed'} /></div>
      {c.answers && <>
        <div className="pf-sec">Exit interview responses</div>
        {c.submitted_at ? <table className="pf"><thead><tr><th style={{ width: '6%' }}>#</th><th style={{ width: '46%' }}>Question</th><th>Response</th></tr></thead>
          <tbody>{qs.filter(q => isShown(q, a) || a[q.code] != null).map((q, i) => <tr key={q.code}><td>{i + 1}</td><td>{fillCompany(q.text, config.companyName)}</td><td style={{ whiteSpace: 'pre-wrap' }}>{val(q)}</td></tr>)}</tbody></table>
          : <div className="pf-box">Form not submitted.</div>}
        <div className="pf-sec">How do we reach out to you?</div>
        <div className="pf-grid"><Cell l="Personal email" v={c.contact?.personal_email} /><Cell l="Mobile" v={c.contact?.mobile} /><Cell l="Preferred contact" v={c.contact?.contact_method} /><Cell l="" v=" " /></div>
      </>}
      {c.meetings && <>
        <div className="pf-sec">ER exit interview meeting</div>
        {c.meetings.length ? c.meetings.map(m => (
          <table className="pf" key={m.id} style={{ marginBottom: 6 }}><tbody>
            <tr><th style={{ width: '26%' }}>Meeting</th><td>{m.ref ? `${m.ref} · ` : ''}{fmtDate(m.date)} {m.time} · {m.mode}{m.location ? ` · ${m.location}` : ''} · {m.status === 'Held' ? 'Conducted' : m.status}</td></tr>
            <tr><th>Participants</th><td>{(m.participants || []).map(p => `${p.name} (${p.kind === 'employee' ? 'Employee' : p.kind === 'officer' ? 'ER officer' : p.role || 'Participant'})`).join('; ')}</td></tr>
            {m.status === 'Held' && <><tr><th>Meeting remarks</th><td style={{ whiteSpace: 'pre-wrap' }}>{m.remarks || '—'}</td></tr>
              <tr><th>Recorded</th><td>{m.minutes_by ? `${m.minutes_by} · ${fmtDateTime(m.minutes_at)}` : '—'}</td></tr></>}
          </tbody></table>)) : <div className="pf-box">No meeting yet.</div>}
      </>}
      {opts.notes && c.notes?.length > 0 && <><div className="pf-sec">Confidential ER notes</div>{c.notes.map(n => <div className="pf-box" key={n.id}><b>{n.created_by} · {fmtDateTime(n.created_at)}</b>{'\n'}{n.body}</div>)}</>}
      <div className="pf-sec">Digital acknowledgements and confirmations</div>
      <Records records={c.records} />
      <p className="pf-note">These entries were captured automatically by the system at the time each action was confirmed, in place of handwritten signatures. They are system records, not formal electronic signatures.{c.records.some(r => r.simulated) ? ' Entries marked “simulated” were made in a local test environment by a simulated user.' : ''}</p>
      <div className="pf-foot"><span>CONFIDENTIAL · Staff file · {c.ref}</span><span>{config.appName}</span></div>
    </>
  );
}
export const printCase = (c, config, opts, by) => printNode(<CaseDoc c={c} config={config} opts={opts} by={by} />);

function ReportDoc({ r, config, by }) {
  const o = r.overview;
  return (
    <>
      <div className="pf-head"><div><div className="pf-org">{config.orgName} · People &amp; Culture</div><h1>Staff Exit Report</h1></div>
        <div className="pf-ref">{r.filters.division || 'All divisions'}<br />{r.filters.from ? fmtDate(r.filters.from) : 'All time'} – {r.filters.to ? fmtDate(r.filters.to) : 'today'}<br />Generated {fmtDateTime(r.generatedAt)} by {by}</div></div>
      <div className="pf-kpis"><div><small>Exits</small><b>{o.exits}</b></div><div><small>Forms (response rate)</small><b>{o.forms} ({o.responseRate ?? 0}%)</b></div>
        <div><small>Exits completed</small><b>{o.completed}</b></div><div><small>Avg overall rating</small><b>{o.avgRating ?? '—'}</b>n = {o.ratingN}</div></div>
      <div className="pf-sec">Divisions</div>
      <table className="pf"><thead><tr><th>Division</th><th>Exits</th><th>Forms</th><th>Avg rating</th><th>n</th></tr></thead>
        <tbody>{o.divisions.map(d => <tr key={d.division}><td>{d.division}</td><td>{d.exits}</td><td>{d.forms}</td><td>{d.avg ?? '—'}{d.insufficient ? ' *' : ''}</td><td>{d.n}</td></tr>)}</tbody></table>
      <p className="pf-note">* fewer than {config.minResponses} ratings — insufficient data. {o.suppressedDivisions.length ? `${o.suppressedDivisions.length} division(s) with fewer than ${o.suppressBelow} forms are not shown for privacy.` : ''}</p>
      <div className="pf-sec">Reasons for leaving</div>
      <table className="pf"><thead><tr><th>Reason</th><th>Mentioned</th></tr></thead><tbody>{o.reasons.slice(0, 8).map(x => <tr key={x.reason}><td>{x.reason}</td><td>{x.count}</td></tr>)}</tbody></table>
      <div className="pf-sec">Experience factors</div>
      <table className="pf"><thead><tr><th>Factor</th><th>Average (1–5)</th><th>n</th></tr></thead><tbody>{o.factors.map(f => <tr key={f.factor}><td>{f.factor}</td><td>{f.avg}{f.insufficient ? ' *' : ''}</td><td>{f.n}</td></tr>)}</tbody></table>
      <div className="pf-foot"><span>CONFIDENTIAL · Aggregated report</span><span>{config.appName}</span></div>
    </>
  );
}
export const printReport = (r, config, by) => printNode(<ReportDoc r={r} config={config} by={by} />);
