// Recruitment: Initiate Release · Staff Releases (with status filters).
// Recruitment sees release progress only — never answers.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { DigitalRecords, History } from '../../components/Records.jsx';
import { Empty, ErrorBox, Fold, Loading, Modal, Pager, StatusBadge, copyText, usePaged } from '../../components/ui.jsx';
import { api, employeeLink, qs } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { addDays, fmtDate, fmtDateTime, today } from '../../lib/format.js';

// ------------------------------------------------------------------ initiate
export function InitiateRelease() {
  const { config, toast, can } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [emp, setEmp] = useState(null);
  const [open, setOpen] = useState(null);
  const [d, setD] = useState({ exit_type: 'Resignation', notice_date: today(), last_day: addDays(today(), 30), note_to_staff: '' });
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { const t = setTimeout(() => api(`/employees${qs({ q })}`).then(x => setList(x.employees)).catch(e => setErr(e.message)), 200); return () => clearTimeout(t); }, [q]);
  if (!can('releases', 'c')) return <main><Empty icon="lock">Your role cannot initiate releases.</Empty></main>;

  const choose = async e => { const x = await api(`/employees/${encodeURIComponent(e.employee_id)}`); setEmp(x.employee); setOpen(x.openRelease); setStep(2); };
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api('/releases', { method: 'POST', body: { employeeId: emp.employee_id, confirmed: ok, details: d } }); setDone(r); setStep(5); toast(`${r.ref} created`); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const STEPS = ['Select employee', 'Review employee', 'Release details', 'Confirm', 'Link issued'];
  return (
    <main>
      <div className="page-head"><div><h1>Initiate staff release</h1><p>Employee details come from the HR system (mock HRIS now; MiHCM later) and cannot be edited here.</p></div></div>
      <div className="steps" style={{ marginBottom: 16 }}>{STEPS.map((s, i) => <div key={s} className={`step ${i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}`}>{i + 1}<b>{s}</b></div>)}</div>
      {err && <div style={{ marginBottom: 12 }}><ErrorBox error={err} /></div>}

      {step === 1 && (
        <section className="card stack">
          <label className="field">Search the staff directory<input type="search" autoFocus placeholder="Name, employee ID or division…" value={q} onChange={e => setQ(e.target.value)} /></label>
          {!list ? <Loading /> : list.length ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Employee ID</th><th>Name</th><th>Job title</th><th>Division</th><th>Department</th><th /></tr></thead>
              <tbody>{list.slice(0, 25).map(e => <tr key={e.employee_id} className="clickable" onClick={() => choose(e)}><td className="mono">{e.employee_id}</td><td><b>{e.name}</b></td><td>{e.job_title}</td><td>{e.division}</td><td>{e.department}</td><td><button className="btn sm">Select</button></td></tr>)}</tbody>
            </table></div>) : <Empty icon="users">No active employees match.</Empty>}
        </section>
      )}

      {step === 2 && emp && (
        <section className="card stack">
          <div className="row between"><h2>{emp.name}</h2><span className="chip">Source: {emp.source === 'mock-hris' ? 'Mock HRIS' : emp.source}</span></div>
          <dl className="kv">
            <dt>Employee ID</dt><dd className="mono">{emp.employee_id}</dd><dt>Job title</dt><dd>{emp.job_title}</dd><dt>Division</dt><dd>{emp.division}</dd>
            <dt>Department</dt><dd>{emp.department}</dd><dt>Line manager</dt><dd>{emp.line_manager || '—'}</dd><dt>Work email</dt><dd>{emp.work_email || '—'}</dd>
          </dl>
          {open && <div className="banner danger"><Icon name="alert" />This employee already has an open release ({open.ref}, {open.status}). Correct or withdraw that one instead.</div>}
          <div className="btns"><button className="btn" onClick={() => setStep(1)}><Icon name="back" size={15} />Back</button><button className="btn primary" disabled={!!open} onClick={() => setStep(3)}>Details are correct — continue</button></div>
        </section>
      )}

      {step === 3 && (
        <section className="card stack">
          <h2>Release details</h2>
          <div className="fields">
            <label className="field">Exit type<select value={d.exit_type} onChange={e => setD({ ...d, exit_type: e.target.value })}>{config.exitTypes.map(t => <option key={t}>{t}</option>)}</select></label>
            <label className="field">Resignation / notice date<input type="date" value={d.notice_date} onChange={e => setD({ ...d, notice_date: e.target.value })} /></label>
            <label className="field">Last working day<input type="date" required value={d.last_day} onChange={e => setD({ ...d, last_day: e.target.value })} /></label>
          </div>
          <label className="field">Note to the employee (optional)<textarea value={d.note_to_staff} onChange={e => setD({ ...d, note_to_staff: e.target.value })} placeholder="e.g. Please return your ID card and laptop on your last day." /></label>
          <div className="btns"><button className="btn" onClick={() => setStep(2)}><Icon name="back" size={15} />Back</button><button className="btn primary" disabled={!d.last_day} onClick={() => setStep(4)}>Review and confirm</button></div>
        </section>
      )}

      {step === 4 && (
        <section className="card stack">
          <h2>Confirm release</h2>
          <dl className="kv"><dt>Employee</dt><dd>{emp.name} (<span className="mono">{emp.employee_id}</span>)</dd><dt>Division</dt><dd>{emp.division}</dd><dt>Exit type</dt><dd>{d.exit_type}</dd>
            <dt>Notice date</dt><dd>{fmtDate(d.notice_date)}</dd><dt>Last working day</dt><dd>{fmtDate(d.last_day)}</dd></dl>
          <div className="banner info small"><Icon name="send" size={16} />The system creates the EX reference and the employee’s link, notifies the employee and the ER team (simulated here), and records your confirmation with the date and time.</div>
          <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I confirm these release details are correct.</label>
          <div className="btns"><button className="btn" onClick={() => setStep(3)}><Icon name="back" size={15} />Back</button><button className="btn primary" disabled={!ok || busy} onClick={submit}><Icon name="send" size={15} />{busy ? 'Initiating…' : 'Initiate release'}</button></div>
        </section>
      )}

      {step === 5 && done && (
        <section className="card stack">
          <div className="banner ok"><Icon name="check" /><div><b><span className="mono">{done.ref}</span> created.</b> The employee’s acknowledgement and exit interview form link is ready.</div></div>
          <label className="field">Employee link (valid until {fmtDate(done.link_expires_at)})<input type="text" readOnly value={employeeLink(done.link)} onFocus={e => e.target.select()} /></label>
          <div className="btns">
            <button className="btn" onClick={() => copyText(employeeLink(done.link), toast)}><Icon name="copy" size={15} />Copy link</button>
            <a className="btn" href={done.link} target="_blank" rel="noreferrer"><Icon name="external" size={15} />Open in a new tab (test as employee)</a>
            <button className="btn primary" onClick={() => nav(`/hr/releases?open=${done.id}`)}>View release</button>
            <button className="btn ghost" onClick={() => { setStep(1); setEmp(null); setOk(false); setDone(null); }}>Initiate another</button>
          </div>
          <p className="small muted">In production the link is sent by email/Teams or the employee completes the form in OneUI/ESS. Here, messages are simulated — see the Notification Centre.</p>
        </section>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ records
function ReleaseModal({ id, onClose, reload }) {
  const { can, toast, confirm, config } = useApp();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => api(`/releases/${id}`).then(setD).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Modal title="Release" onClose={onClose}><Loading /></Modal>;
  const r = d.release;
  const active = !r.withdrawn_at && !r.closed_at;
  const act = async (fn, msg) => { try { await fn(); toast(msg); await load(); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Modal wide title={`${r.ref} · ${r.name}`} onClose={onClose}>
      <div className="row between"><StatusBadge status={r.status} /><span className="small muted">Source: {r.source === 'app' ? 'Recruitment (this app)' : r.source.toUpperCase()}</span></div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <dl className="kv"><dt>Employee ID</dt><dd className="mono">{r.employee_uid}</dd><dt>Division</dt><dd>{r.division}</dd><dt>Exit type</dt><dd>{r.exit_type}</dd><dt>Notice date</dt><dd>{fmtDate(r.notice_date)}</dd>
          <dt>Last working day</dt><dd>{fmtDate(r.last_day)}</dd><dt>Released</dt><dd>{fmtDateTime(r.released_at)}</dd><dt>Acknowledged</dt><dd>{r.acknowledged_at ? fmtDateTime(r.acknowledged_at) : 'Pending'}</dd>
          <dt>Exit form</dt><dd>{r.submitted_at ? `Submitted ${fmtDate(r.submitted_at)}` : r.form_started_at ? 'In progress' : 'Not started'}</dd>{r.closed_at ? <><dt>Exit completed</dt><dd>{fmtDateTime(r.closed_at)}</dd></> : <><dt>Link valid until</dt><dd>{fmtDate(r.link_expires_at)}</dd></>}</dl>
        <div className="stack">
          {active && <div className="btns">
            <button className="btn sm" onClick={() => copyText(employeeLink(`/exit/${r.access_code}`), toast)}><Icon name="copy" size={13} />Copy employee link</button>
            <a className="btn sm" href={`/exit/${r.access_code}`} target="_blank" rel="noreferrer"><Icon name="external" size={13} />Open link</a>
            {can('releases', 'u') && !r.submitted && <button className="btn sm" onClick={() => act(() => api(`/releases/${r.id}/remind`, { method: 'POST' }), 'Reminder sent (simulated)')}><Icon name="bell" size={13} />Send reminder</button>}
            {can('releases', 'u') && <button className="btn sm" onClick={() => setEdit({ exit_type: r.exit_type, notice_date: r.notice_date || '', last_day: r.last_day, note_to_staff: r.note_to_staff || '', reason: '' })}><Icon name="edit" size={13} />Correct details</button>}
            {can('releases', 'd') && <button className="btn sm danger" onClick={async () => { const reason = await confirm({ title: `Withdraw ${r.ref}?`, body: 'The employee link stops working. Nothing is deleted — the release and its history stay on record.', confirmLabel: 'Withdraw release', danger: true, input: { label: 'Reason (required)', required: true } }); if (reason) act(() => api(`/releases/${r.id}/withdraw`, { method: 'POST', body: { reason } }), 'Release withdrawn'); }}><Icon name="trash" size={13} />Withdraw</button>}
          </div>}
          {r.withdrawn_at && <div className="banner warn small"><Icon name="alert" />Withdrawn {fmtDateTime(r.withdrawn_at)}: {r.withdrawn_reason}</div>}
          <div className="banner info small"><Icon name="lock" size={16} />Interview answers and ER notes are confidential to the ER team.</div>
        </div>
      </div>
      {edit && (
        <div className="card flat stack">
          <h3>Correct release details</h3>
          <div className="fields">
            <label className="field">Exit type<select value={edit.exit_type} onChange={e => setEdit({ ...edit, exit_type: e.target.value })}>{config.exitTypes.map(t => <option key={t}>{t}</option>)}</select></label>
            <label className="field">Notice date<input type="date" value={edit.notice_date} onChange={e => setEdit({ ...edit, notice_date: e.target.value })} /></label>
            <label className="field">Last working day<input type="date" value={edit.last_day} onChange={e => setEdit({ ...edit, last_day: e.target.value })} /></label>
          </div>
          <label className="field">Note to employee<input type="text" value={edit.note_to_staff} onChange={e => setEdit({ ...edit, note_to_staff: e.target.value })} /></label>
          <label className="field">Reason for the correction (required)<input type="text" value={edit.reason} onChange={e => setEdit({ ...edit, reason: e.target.value })} /></label>
          <div className="btns"><button className="btn primary" disabled={!edit.reason.trim()} onClick={() => act(async () => { const { reason, ...changes } = edit; await api(`/releases/${r.id}`, { method: 'PUT', body: { changes, reason } }); setEdit(null); }, 'Release corrected — previous values kept in history')}>Save correction</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
        </div>
      )}
      <div className="stack" style={{ gap: 8 }}>
        <Fold title="Release history" sub={`${d.history.length} events`}><History events={d.history} /></Fold>
        <Fold title="Digital records" sub={`${d.records.length} confirmations`}><DigitalRecords compact records={d.records} /></Fold>
      </div>
    </Modal>
  );
}

const PENDING = r => !r.withdrawn_at && !r.closed_at && ['Released', 'Acknowledged', 'Form in progress'].includes(r.status);
const RVIEWS = { all: ['All', () => true], pending: ['Awaiting employee', PENDING], active: ['With ER', r => !r.withdrawn_at && !r.closed_at && r.submitted],
  completed: ['Exit completed', r => !!r.closed_at], other: ['No response / withdrawn', r => r.status === 'No response' || !!r.withdrawn_at] };
export function ReleaseRecords() {
  const { can } = useApp();
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');
  const view = RVIEWS[params.get('view')] ? params.get('view') : 'all';
  const load = () => api('/releases').then(setD).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const rows = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.releases.filter(r => RVIEWS[view][1](r) && (!s || [r.ref, r.name, r.employee_uid, r.division].join(' ').toLowerCase().includes(s)));
  }, [d, q, view]);
  const pg = usePaged(rows, 15);
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!d) return <main><Loading /></main>;
  const setView = v => setParams(v === 'all' ? {} : { view: v });
  return (
    <main>
      <div className="page-head"><div><h1>Staff releases</h1><p>{d.stats.total} releases · {d.stats.awaitingAck} awaiting acknowledgement · {d.stats.closed} exits completed</p></div>
        {can('releases', 'c') && <Link className="btn primary" to="/hr/releases/new"><Icon name="send" size={15} />Initiate release</Link>}</div>
      <div className="card flat" style={{ marginBottom: 12, padding: 12 }}>
        <input type="search" aria-label="Search" placeholder="Search name, reference, employee ID, division…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
        <div className="row" style={{ gap: 6, marginTop: 10 }}>{Object.entries(RVIEWS).map(([k, [l, f]]) => <button key={k} className={`btn sm ${view === k ? 'primary' : ''}`} onClick={() => setView(k)}>{l} <span className="tiny" style={{ opacity: .75 }}>{d.releases.filter(f).length}</span></button>)}</div>
      </div>
      {rows.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Reference</th><th>Employee</th><th>Division</th><th>Last working day</th><th>Acknowledged</th><th>Exit form</th><th>Status</th></tr></thead>
          <tbody>{pg.slice.map(r => (
            <tr key={r.id} className="clickable" onClick={() => setParams({ ...(view !== 'all' ? { view } : {}), open: r.id })}>
              <td className="mono">{r.ref}</td><td><b>{r.name}</b><div className="tiny muted mono">{r.employee_uid}</div></td><td className="small">{r.division}</td><td className="small">{fmtDate(r.last_day)}</td>
              <td>{r.acknowledged_at ? <span className="chip green">{fmtDate(r.acknowledged_at)}</span> : <span className="chip sky">Awaiting</span>}</td>
              <td>{r.submitted ? <span className="chip green">Submitted</span> : r.form_started_at ? <span className="chip violet">In progress</span> : <span className="chip">Not started</span>}</td>
              <td><StatusBadge status={r.status} /></td>
            </tr>))}</tbody>
        </table></div>) : <Empty icon="send">{view === 'pending' ? 'No releases are waiting on the employee.' : 'No releases match.'}</Empty>}
      <Pager {...pg} />
      {openId && <ReleaseModal id={openId} onClose={() => setParams(view !== 'all' ? { view } : {})} reload={load} />}
    </main>
  );
}
