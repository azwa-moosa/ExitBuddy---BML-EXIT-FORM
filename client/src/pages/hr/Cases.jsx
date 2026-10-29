// ER cases: case list, case record, the mandatory ER meeting (participants,
// conducted, one Meeting Remarks box), Complete Exit, confidential notes and
// the printable exit interview record.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import Questions, { AnswerView, missingRequired } from '../../components/Questions.jsx';
import { DigitalRecords, History } from '../../components/Records.jsx';
import { Empty, ErrorBox, Fold, Loading, Lock, Modal, Pager, StarsStatic, StatusBadge, copyText, usePaged } from '../../components/ui.jsx';
import { printCase } from '../../components/Print.jsx';
import { api, employeeLink } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { addDays, fmtDate, fmtDateTime, initials, ratingClass, today } from '../../lib/format.js';

const VIEWS = {
  all: ['All', () => true],
  action: ['Needs action', c => !!c.action],
  employee: ['Awaiting employee', c => ['Released', 'Acknowledged', 'Form in progress'].includes(c.status)],
  schedule: ['Meeting to schedule', c => c.status === 'Submitted'],
  scheduled: ['Meeting scheduled', c => c.status === 'Meeting scheduled'],
  conducted: ['Meeting conducted', c => c.status === 'Interviewed'],
  completed: ['Completed', c => c.status === 'Closed'],
  other: ['No response / withdrawn', c => ['No response', 'Withdrawn'].includes(c.status)],
};
const urgent = a => /Overdue|Reminder|Reschedule|outcome/.test(a || '');

export function CaseList() {
  const { config, can } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = VIEWS[params.get('view')] ? params.get('view') : 'all';
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [q, setQ] = useState(''); const [mine, setMine] = useState(false); const [div, setDiv] = useState('');
  const load = () => api('/cases').then(setD).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const rows = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.cases.filter(c => VIEWS[view][1](c) && (!mine || c.assigned_to === d.me) && (!div || c.division === div)
      && (!s || [c.name, c.ref, c.division, c.department, c.job_title, c.employee_uid].join(' ').toLowerCase().includes(s)));
  }, [d, q, view, mine, div]);
  const pg = usePaged(rows, 15);
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!d) return <main><Loading /></main>;
  const editor = can('cases', 'u');
  return (
    <main>
      <div className="page-head"><div><h1>{editor ? 'Exit cases' : 'Exit interview status'}</h1><p>{d.cases.filter(c => c.submitted_at).length} forms submitted · {d.cases.length} releases{!can('responses', 'r') && ' · individual responses are not visible to your role'}</p></div></div>
      <div className="card flat" style={{ marginBottom: 12, padding: 12 }}>
        <div className="row">
          <input type="search" aria-label="Search" placeholder="Search name, reference, division or job title…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <select aria-label="Division" value={div} onChange={e => setDiv(e.target.value)} style={{ maxWidth: 220 }}><option value="">All divisions</option>{config.divisions.map(x => <option key={x}>{x}</option>)}</select>
          {editor && <label className="switch"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />Assigned to me</label>}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 10 }}>{Object.entries(VIEWS).map(([k, [label, f]]) => <button key={k} className={`btn sm ${view === k ? 'primary' : ''}`} onClick={() => setParams(k === 'all' ? {} : { view: k })}>{label} <span className="tiny" style={{ opacity: .75 }}>{d.cases.filter(f).length}</span></button>)}</div>
      </div>
      {rows.length ? (
        <div className="tablewrap"><table>
          <thead><tr>{can('responses', 'r') && <th>Rating</th>}<th>Employee</th><th>Division</th><th>Status</th><th>Next action</th><th>Assigned</th><th>Date</th></tr></thead>
          <tbody>{pg.slice.map(c => (
            <tr key={c.id} className="clickable" onClick={e => { if (!e.target.closest('a')) navigate(`/hr/cases/${c.id}`); }}>
              {can('responses', 'r') && <td><span className={`score ${ratingClass(c.rating)}`}>{c.rating ?? '—'}</span></td>}
              <td><Link to={`/hr/cases/${c.id}`}><b>{c.name}</b></Link><div className="tiny muted"><span className="mono">{c.ref}</span> · {c.job_title}</div></td>
              <td className="small">{c.division}</td>
              <td><StatusBadge status={c.status} /></td>
              <td className="small">{c.action ? <span className={`chip ${urgent(c.action) ? 'amber' : 'brand'}`}>{c.action}</span> : <span className="muted">—</span>}{c.nextMeeting && <div className="tiny muted">Meeting {fmtDate(c.nextMeeting.date)} {c.nextMeeting.time}</div>}</td>
              <td className="small">{c.assignee || <span className="muted">—</span>}</td>
              <td className="small">{c.closed_at ? `Completed ${fmtDate(c.closed_at)}` : c.submitted_at ? `Form ${fmtDate(c.submitted_at)}` : `LWD ${fmtDate(c.last_day)}`}</td>
            </tr>))}</tbody>
        </table></div>) : <Empty icon="inbox">{view === 'action' ? 'Nothing needs action right now.' : 'No cases match.'}</Empty>}
      <Pager {...pg} />
    </main>
  );
}

const FLOW = [['Released', 'Released'], ['Acknowledged', 'Acknowledged'], ['Submitted', 'Form submitted'], ['Meeting scheduled', 'ER meeting'], ['Interviewed', 'Meeting conducted'], ['Closed', 'Exit completed']];

export function CaseRecord() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, config, toast, confirm, user } = useApp();
  const [c, setC] = useState(null); const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [staff, setStaff] = useState({ users: [], people: [] });
  const load = useCallback(() => api(`/cases/${id}`).then(d => setC(d.case)).catch(e => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (can('cases', 'u') || can('meetings', 'c')) api('/staff/er').then(setStaff).catch(() => {}); }, [can]);
  if (err) return <main><ErrorBox error={err} /><p style={{ marginTop: 10 }}><Link to="/hr/cases">Back to cases</Link></p></main>;
  if (!c) return <main><Loading /></main>;

  const act = async (path, body, msg, method = 'POST') => { try { const r = await api(path, { method, body }); toast(msg); await load(); return r; } catch (e) { toast(e.message, 'error'); return null; } };
  const editor = can('cases', 'u') && c.status !== 'Withdrawn';
  const open = !['Closed', 'Withdrawn', 'No response'].includes(c.status);
  const stepIdx = c.status === 'Form in progress' ? 1 : FLOW.findIndex(([k]) => k === c.status);
  const s = c.summary;
  const complete = async () => {
    if (await confirm({ title: 'Complete exit?', body: `${c.employee.name}'s exit will be marked completed. Your name, role, date and time are recorded automatically.`, confirmLabel: 'Complete Exit' })) act(`/cases/${c.id}/complete`, {}, 'Exit completed');
  };

  return (
    <main className="stack" style={{ gap: 14 }}>
      <div className="row between">
        <Link className="btn ghost" to={-1} onClick={e => { e.preventDefault(); nav(-1); }}><Icon name="back" size={16} />Back</Link>
        <button className="btn" onClick={() => setModal({ type: 'print' })}><Icon name="print" size={15} />Exit interview record (PDF)</button>
      </div>

      <section className="hero" style={{ padding: '18px 22px' }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 14 }}><span className="avatar" style={{ width: 48, height: 48, fontSize: 17, background: 'rgba(255,255,255,.2)' }}>{initials(c.employee.name)}</span>
            <div><h1>{c.employee.name}</h1><p>{c.employee.job_title} · {c.employee.division} · <span className="mono">{c.employee.employee_uid}</span></p></div></div>
          <div style={{ textAlign: 'right' }}><span className="chip mono">{c.ref}</span><p className="small" style={{ marginTop: 6 }}>Last working day <b>{fmtDate(c.release.last_day)}</b></p><p className="small">{c.statusLabel}</p></div>
        </div>
      </section>
      <div className="steps">{FLOW.map(([k, l], i) => <div key={k} className={`step ${['Withdrawn', 'No response'].includes(c.status) ? (i === 0 ? 'off' : '') : i < stepIdx || c.status === 'Closed' ? 'done' : i === stepIdx ? 'now' : ''}`}>{i + 1}<b>{l}</b></div>)}</div>
      {c.status === 'Withdrawn' && <div className="banner warn"><Icon name="alert" />Release withdrawn {fmtDateTime(c.release.withdrawn_at)}: {c.release.withdrawn_reason}</div>}
      {c.status === 'No response' && <div className="banner warn"><Icon name="alert" />No response — the form was not submitted.{can('cases', 'c') ? ' You can enter a paper form if the employee completed one.' : ''}</div>}

      <div className="split">
        <div className="stack" style={{ gap: 14 }}>
          {c.confidential.meetings && <MeetingSection c={c} staff={staff} open={open} act={act} setModal={setModal} reload={load} />}

          <section className="card stack">
            <div className="card-head" style={{ marginBottom: 0 }}><div><h2>Exit interview form</h2><p>{c.submitted_at ? `Submitted ${fmtDateTime(c.submitted_at)}${c.entered_by ? ` · paper form entered by ${c.entered_by}` : ''}` : c.form_started_at ? 'In progress (draft not visible to HR)' : 'Not submitted yet'}</p></div>
              {s?.overall != null && <span className={`score solid ${ratingClass(s.overall)}`}>{s.overall}</span>}</div>
            {!c.confidential.responses ? <Lock>Individual responses are confidential. Your role sees status only.</Lock>
              : !c.submitted_at ? <Empty icon="file">{c.release.acknowledged_at ? `Release acknowledged ${fmtDateTime(c.release.acknowledged_at)}. Waiting for the form.` : 'Waiting for the employee to acknowledge the release.'}
                {can('cases', 'c') && c.status !== 'Withdrawn' && <div style={{ marginTop: 12 }}><button className="btn" onClick={() => setModal({ type: 'paper' })}><Icon name="edit" size={15} />Enter a paper form</button></div>}</Empty>
                : <>
                  <div className="grid g3">
                    <div className="card flat" style={{ padding: 12 }}><p className="label">Overall</p>{s.overall != null ? <><StarsStatic value={s.overall} /> <b>{s.overall}/5</b></> : <span className="muted">No rating</span>}</div>
                    <div className="card flat" style={{ padding: 12 }}><p className="label">Reasons</p><b className="small">{s.reasons.join(', ') || '—'}</b></div>
                    <div className="card flat" style={{ padding: 12 }}><p className="label">Would return / refer</p><span className="small">{s.wouldReturn == null ? '—' : s.wouldReturn ? 'Would return' : 'Would not return'} · {s.wouldRefer == null ? '—' : s.wouldRefer ? 'would refer' : 'would not refer'}</span></div>
                  </div>
                  <Fold title="All answers" sub={`${Object.keys(c.answers).length} answered`}><AnswerView questions={c.questionnaire.questions} answers={c.answers} /></Fold>
                </>}
          </section>

          {c.confidential.notes ? <Notes c={c} reload={load} /> : null}
        </div>

        <aside className="stack" style={{ gap: 14 }}>
          {editor && open && <CompleteCard c={c} onComplete={complete} />}
          {c.status === 'Closed' && <section className="card"><div className="banner ok"><Icon name="check" /><div><b>Exit completed</b><br />{fmtDateTime(c.closed_at)}</div></div>
            {editor && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={async () => { const r = await confirm({ title: 'Reopen exit', body: 'Reopening is recorded in the history.', confirmLabel: 'Reopen', input: { label: 'Reason (required)', required: true } }); if (r) act(`/cases/${c.id}/reopen`, { reason: r }, 'Exit reopened'); }}>Reopen exit</button>}</section>}
          {editor && c.status === 'No response' && <section className="card"><button className="btn sm" onClick={async () => { const r = await confirm({ title: 'Reopen', body: 'Reopening is recorded in the history.', confirmLabel: 'Reopen', input: { label: 'Reason (required)', required: true } }); if (r) act(`/cases/${c.id}/reopen`, { reason: r }, 'Reopened'); }}>Reopen</button></section>}

          {editor && open && (
            <section className="card stack">
              <label className="field">Responsible ER officer<select value={c.assigned_to || ''} onChange={e => act(`/cases/${c.id}/assign`, { userId: Number(e.target.value) }, 'Case assigned')}><option value="" disabled>Choose…</option>{staff.users.map(u => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</select></label>
              {!c.submitted_at && <div className="btns">
                <button className="btn sm" onClick={() => act(`/releases/${c.id}/remind`, {}, 'Reminder sent (simulated)')}><Icon name="bell" size={13} />Send reminder</button>
                {c.access_link && <button className="btn sm" onClick={() => copyText(employeeLink(c.access_link), toast)}><Icon name="copy" size={13} />Copy link</button>}
                {can('cases', 'c') && <button className="btn sm" onClick={() => setModal({ type: 'paper' })}><Icon name="edit" size={13} />Paper form</button>}
                <button className="btn sm" onClick={async () => { if (await confirm({ title: 'Mark as no response?', body: 'Use this when the employee did not complete the form.', confirmLabel: 'Mark no response' })) act(`/cases/${c.id}/no-response`, {}, 'Marked as no response'); }}>No response</button>
              </div>}
              {(can('cases', 'd') || can('releases', 'd')) && <button className="btn sm ghost danger" onClick={async () => { const r = await confirm({ title: `Withdraw ${c.ref}?`, body: 'The release is withdrawn and the employee link stops working. Nothing is deleted; the history is kept.', confirmLabel: 'Withdraw', danger: true, input: { label: 'Reason (required)', required: true } }); if (r) act(`/releases/${c.id}/withdraw`, { reason: r }, 'Release withdrawn'); }}><Icon name="trash" size={13} />Withdraw release</button>}
            </section>
          )}

          <section className="card">
            <dl className="kv">
              <dt>Department</dt><dd>{c.employee.department || '—'}</dd><dt>Line manager</dt><dd>{c.employee.line_manager || '—'}</dd>
              <dt>Exit type</dt><dd>{c.release.exit_type}</dd><dt>Released</dt><dd>{fmtDateTime(c.release.released_at)}</dd>
              <dt>Acknowledged</dt><dd>{c.release.acknowledged_at ? fmtDateTime(c.release.acknowledged_at) : 'Pending'}</dd><dt>ER officer</dt><dd>{c.assignee?.name || '—'}</dd>
              {c.contact && <><dt>Personal email</dt><dd>{c.contact.personal_email || '—'}</dd><dt>Mobile</dt><dd>{c.contact.mobile || '—'}</dd><dt>Preferred contact</dt><dd>{c.contact.contact_method || '—'}</dd></>}
            </dl>
          </section>
          <div className="stack" style={{ gap: 8 }}>
            <Fold title="Digital records" sub={`${c.records.length} confirmations`}><DigitalRecords compact records={c.records} /></Fold>
            <Fold title="Workflow history" sub={`${c.history.length} events`}><History events={c.history} /></Fold>
          </div>
        </aside>
      </div>

      {modal?.type === 'meeting' && <MeetingModal c={c} m={modal.m} staff={staff} me={user} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); }} />}
      {modal?.type === 'paper' && <PaperModal c={c} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); }} />}
      {modal?.type === 'print' && <PrintModal c={c} onClose={() => setModal(null)} onPrint={async opts => { setModal(null); await api(`/cases/${c.id}/record-generated`, { method: 'POST', body: opts }).catch(() => {}); printCase(c, config, opts, `${user.name} (${user.role})`); load(); }} />}
    </main>
  );
}

// The one decision card: what is still missing, then Complete Exit.
function CompleteCard({ c, onComplete }) {
  const held = (c.meetings || []).some(m => m.status === 'Held');
  const remarks = (c.meetings || []).some(m => m.status === 'Held' && m.remarks);
  const checks = [['Exit interview form submitted', !!c.submitted_at], ['ER meeting conducted', held], ['Meeting remarks recorded', remarks]];
  return (
    <section className="card stack">
      <h3>Complete exit</h3>
      <ul className="checklist">{checks.map(([l, ok]) => <li key={l} className={ok ? 'ok' : ''}><Icon name={ok ? 'check' : 'clock'} size={14} />{l}</li>)}</ul>
      <button className="btn primary" style={{ justifyContent: 'center' }} disabled={!!c.completion_blocker} onClick={onComplete}><Icon name="check" size={15} />Complete Exit</button>
      {c.completion_blocker && <p className="tiny muted">{c.completion_blocker}</p>}
    </section>
  );
}

function MeetingSection({ c, staff, open, act, setModal, reload }) {
  const { can, confirm } = useApp();
  const ms = c.meetings || [];
  const current = ms.filter(m => ['Scheduled', 'Held'].includes(m.status));
  const earlier = ms.filter(m => !['Scheduled', 'Held'].includes(m.status));
  const canSchedule = can('meetings', 'c') && open && c.submitted_at && !ms.some(m => m.status === 'Scheduled') && !ms.some(m => m.status === 'Held');
  return (
    <section className="card">
      <div className="card-head"><div><h2>ER exit interview meeting</h2><p>Mandatory before the exit can be completed</p></div>
        {canSchedule && <button className="btn primary sm" onClick={() => setModal({ type: 'meeting' })}><Icon name="cal" size={14} />{earlier.length ? 'Schedule new meeting' : 'Schedule ER meeting'}</button>}</div>
      {current.map(m => (
        <div className="minutes stack" key={m.id} style={{ gap: 10, marginBottom: 10 }}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div><b>{fmtDate(m.date)} · {m.time}</b> <span className={`chip ${m.status === 'Held' ? 'green' : 'brand'}`}>{m.status === 'Held' ? 'Conducted' : 'Scheduled'}</span>
              <div className="small muted">{m.mode}{m.location ? ` · ${m.location}` : ''} · <span className="mono">{m.ref}</span></div></div>
            {m.status === 'Scheduled' && can('meetings', 'u') && open && <div className="btns">
              <button className="btn primary sm" onClick={async () => { if (await confirm({ title: 'Mark meeting as conducted?', body: 'Then record the meeting remarks. Your name, date and time are recorded automatically.', confirmLabel: 'Mark conducted' })) act(`/meetings/${m.id}/conducted`, {}, 'Meeting marked as conducted'); }}><Icon name="check" size={13} />Mark conducted</button>
              <button className="btn sm" onClick={() => setModal({ type: 'meeting', m })}><Icon name="edit" size={13} />Edit</button>
              <MoreMenu items={[
                ['No-show', async () => { if (await confirm({ title: 'Record no-show?', body: 'The exit cannot be completed until a meeting is conducted — schedule a new one.', confirmLabel: 'Record no-show' })) act(`/meetings/${m.id}`, { status: 'No show' }, 'No-show recorded', 'PUT'); }],
                ['Cancel meeting', async () => { const r = await confirm({ title: 'Cancel meeting', body: 'The employee and participants are notified (simulated). A new meeting is still required.', confirmLabel: 'Cancel meeting', danger: true, input: { label: 'Reason (optional)' } }); if (r !== false) act(`/meetings/${m.id}`, { status: 'Cancelled', reason: r || undefined }, 'Meeting cancelled', 'PUT'); }],
                can('meetings', 'd') && ['Delete entry', async () => { if (await confirm({ title: 'Delete meeting entry', body: 'Use only for an entry made by mistake. This is recorded in the history.', confirmLabel: 'Delete', danger: true })) act(`/meetings/${m.id}`, undefined, 'Meeting deleted', 'DELETE'); }],
              ].filter(Boolean)} />
            </div>}
          </div>
          <div className="row" style={{ gap: 6 }}>{m.participants.map((p, i) => <span key={i} className={`chip ${p.required ? 'brand' : ''}`} title={p.required ? 'Required participant' : p.kind === 'external' ? 'Added by name' : p.role}>{p.name}<span className="tiny" style={{ opacity: .7 }}>· {p.kind === 'employee' ? 'Employee' : p.kind === 'officer' ? 'ER officer' : p.role || 'Participant'}</span></span>)}</div>
          {m.status === 'Held' && <Remarks m={m} editable={can('meetings', 'u') && open} reload={reload} />}
        </div>
      ))}
      {!current.length && <Empty icon="cal">{c.submitted_at ? (earlier.length ? 'The last meeting did not take place. Schedule a new ER meeting.' : 'No ER meeting yet. Schedule it to continue.') : 'The meeting is scheduled after the employee submits the exit form.'}</Empty>}
      {earlier.length > 0 && <div style={{ marginTop: 8 }}><Fold title="Earlier meetings" sub={earlier.map(m => `${fmtDate(m.date)} · ${m.status}`).join(' · ')}>
        <div className="list">{earlier.map(m => <div key={m.id} className="small"><span className="chip red">{m.status}</span> {fmtDate(m.date)} {m.time} · {m.mode} · {m.interviewer} <span className="mono tiny">{m.ref}</span></div>)}</div>
      </Fold></div>}
    </section>
  );
}

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false); const ref = useRef();
  useEffect(() => { const f = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn sm" aria-label="More meeting actions" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="down" size={13} />More</button>
      {open && <div className="menu" role="menu">{items.map(([l, fn]) => <button key={l} role="menuitem" onClick={() => { setOpen(false); fn(); }}>{l}</button>)}</div>}
    </div>
  );
}

// Meeting Remarks — the single text box. Recorder, date and time are automatic.
function Remarks({ m, editable, reload }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState(!m.remarks);
  const [text, setText] = useState(m.remarks || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(`/meetings/${m.id}/remarks`, { method: 'POST', body: { remarks: text } }); toast('Meeting remarks saved — your name, date and time were recorded'); setEdit(false); await reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (editable && edit) return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="field">Meeting Remarks<textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Summary of the meeting, main discussion points and any relevant remarks…" /></label>
      <div className="row between"><span className="tiny muted">Meeting reference, your name, date and time are recorded automatically.</span>
        <div className="btns">{m.remarks && <button className="btn sm" onClick={() => { setText(m.remarks); setEdit(false); }}>Cancel</button>}<button className="btn primary sm" disabled={!text.trim() || busy} onClick={save}><Icon name="check" size={13} />Save remarks</button></div></div>
    </div>
  );
  return (
    <div>
      <p className="label">Meeting Remarks</p>
      {m.remarks ? <div className="quote-box small">{m.remarks}</div> : <p className="small muted">Not recorded yet.</p>}
      <div className="row between" style={{ marginTop: 6 }}><span className="tiny muted">{m.minutes_by ? `Recorded by ${m.minutes_by} · ${fmtDateTime(m.minutes_at)}` : ''}{m.conducted_at ? ` · conducted ${fmtDateTime(m.conducted_at)}` : ''}</span>
        {editable && <button className="btn ghost sm" onClick={() => setEdit(true)}><Icon name="edit" size={13} />Edit</button>}</div>
    </div>
  );
}

function Notes({ c, reload }) {
  const { can, toast, confirm } = useApp();
  const [text, setText] = useState(''); const [edit, setEdit] = useState(null);
  const run = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Fold title="Confidential ER notes" sub={c.notes.length ? `${c.notes.length} note${c.notes.length > 1 ? 's' : ''}` : 'None'}>
      <div className="stack">
        {c.notes.map(n => edit?.id === n.id ? (
          <div key={n.id} className="stack"><textarea value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} /><div className="btns"><button className="btn primary sm" onClick={() => run(async () => { await api(`/notes/${n.id}`, { method: 'PUT', body: { body: edit.body } }); setEdit(null); }, 'Note updated')}>Save</button><button className="btn sm" onClick={() => setEdit(null)}>Cancel</button></div></div>
        ) : (
          <div key={n.id} className="note">
            <div className="row between"><div className="by">{n.created_by} · {fmtDateTime(n.created_at)}{n.updated_at ? ' · edited' : ''}</div>
              <div className="btns">{can('notes', 'u') && <button className="btn ghost sm" aria-label="Edit note" onClick={() => setEdit({ id: n.id, body: n.body })}><Icon name="edit" size={13} /></button>}
                {can('notes', 'd') && <button className="btn ghost sm" aria-label="Delete note" onClick={async () => { if (await confirm({ title: 'Delete note', body: 'The deletion is recorded in the history.', confirmLabel: 'Delete', danger: true })) run(() => api(`/notes/${n.id}`, { method: 'DELETE' }), 'Note deleted'); }}><Icon name="trash" size={13} /></button>}</div></div>
            {n.body}
          </div>))}
        {can('notes', 'c') && <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
          <textarea aria-label="Add a confidential note" style={{ minHeight: 44 }} value={text} onChange={e => setText(e.target.value)} placeholder="Add a confidential note…" />
          <button className="btn sm" disabled={!text.trim()} onClick={() => run(async () => { await api(`/cases/${c.id}/notes`, { method: 'POST', body: { body: text } }); setText(''); }, 'Note added')}><Icon name="plus" size={14} />Add</button>
        </div>}
      </div>
    </Fold>
  );
}

// Searchable participant picker: configured users, or anyone typed by name.
function PeoplePicker({ people, value, onChange, required }) {
  const [q, setQ] = useState(''); const [email, setEmail] = useState(''); const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => { const f = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  const taken = new Set([...value.filter(p => p.userId).map(p => p.userId), ...required.filter(p => p.userId).map(p => p.userId)]);
  const s = q.trim().toLowerCase();
  const matches = people.filter(u => !taken.has(u.id) && (!s || `${u.name} ${u.role}`.toLowerCase().includes(s))).slice(0, 8);
  const addUser = u => { onChange([...value, { userId: u.id, name: u.name, role: u.role }]); setQ(''); setOpen(false); };
  const addExternal = () => { if (!q.trim()) return; onChange([...value, { name: q.trim(), email: email.trim() || undefined }]); setQ(''); setEmail(''); setOpen(false); };
  return (
    <div className="field" ref={ref}>Participants
      <div className="people">
        {required.map(p => <span key={p.name} className="chip brand" title="Required participant">{p.name}<span className="tiny" style={{ opacity: .7 }}>· {p.role}</span></span>)}
        {value.map((p, i) => <span key={i} className="chip">{p.name}{p.role ? <span className="tiny" style={{ opacity: .7 }}>· {p.role}</span> : p.email ? <span className="tiny" style={{ opacity: .7 }}>· {p.email}</span> : null}
          <button type="button" className="linkbtn" aria-label={`Remove ${p.name}`} onClick={() => onChange(value.filter((_, k) => k !== i))}>×</button></span>)}
        <div className="people-in">
          <input type="search" aria-label="Add participant" placeholder="Search users or type a name…" value={q} onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) addUser(matches[0]); else addExternal(); } }} />
          {open && (matches.length > 0 || s) && <div className="menu wide" role="listbox">
            {matches.map(u => <button type="button" key={u.id} role="option" onClick={() => addUser(u)}><b>{u.name}</b> <span className="tiny muted">{u.role}{u.persona ? ' · demo' : ''}</span></button>)}
            {s && !people.some(u => u.name.toLowerCase() === s) && <div className="menu-ext">
              <span className="tiny muted">Not in the user list? Add “{q.trim()}” by name</span>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}><input type="email" aria-label="Email (optional)" placeholder="Email (optional)" value={email} onChange={e => setEmail(e.target.value)} /><button type="button" className="btn sm" onClick={addExternal}><Icon name="plus" size={13} />Add</button></div>
            </div>}
          </div>}
        </div>
      </div>
      <span className="hint">The employee and the ER officer are always included. Participants who are users are notified (simulated).</span>
    </div>
  );
}

function MeetingModal({ c, m, staff, me, onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState(m ? { date: m.date, time: m.time, mode: m.mode, location: m.location || '', interviewerId: m.interviewer_id || me.id }
    : { date: addDays(today(), 2), time: '10:00', mode: 'In person', location: 'P&C meeting room 2', interviewerId: (staff.users.find(u => u.id === (c.assigned_to || me.id)) || staff.users[0] || {}).id });
  const [people, setPeople] = useState(() => (m?.participants || []).filter(p => !p.required).map(p => p.user_id ? { userId: p.user_id, name: p.name, role: p.role } : { name: p.name, email: p.email || undefined }));
  const officer = staff.users.find(u => u.id === f.interviewerId);
  const save = async e => {
    e.preventDefault();
    const participants = people.filter(p => p.userId !== f.interviewerId).map(p => p.userId ? { userId: p.userId } : { name: p.name, email: p.email });
    try { await api(m ? `/meetings/${m.id}` : `/cases/${c.id}/meetings`, { method: m ? 'PUT' : 'POST', body: { ...f, participants } }); toast(m ? 'Meeting updated — participants notified (simulated)' : 'ER meeting scheduled — employee and participants notified (simulated)'); onDone(); }
    catch (x) { toast(x.message, 'error'); }
  };
  return (
    <Modal title={`${m ? 'Update' : 'Schedule'} ER meeting · ${c.employee.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="mtg"><Icon name="cal" size={15} />{m ? 'Save' : 'Schedule'}</button></>}>
      <form id="mtg" className="stack" onSubmit={save}>
        <div className="fields">
          <label className="field">Date<input type="date" required value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
          <label className="field">Time<input type="time" required value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></label>
          <label className="field">Format<select value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}><option>In person</option><option>Microsoft Teams</option><option>Phone</option></select></label>
          <label className="field">ER officer<select required value={f.interviewerId || ''} onChange={e => setF({ ...f, interviewerId: Number(e.target.value) })}>{staff.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        <label className="field">Location or Teams link<input type="text" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></label>
        <PeoplePicker people={staff.people} value={people} onChange={setPeople}
          required={[{ name: c.employee.name, role: 'Employee' }, ...(officer ? [{ userId: officer.id, name: officer.name, role: 'ER officer' }] : [])]} />
        <p className="tiny muted">Last working day {fmtDate(c.release.last_day)}. The meeting reference is created automatically.</p>
      </form>
    </Modal>
  );
}

function PaperModal({ c, onClose, onDone }) {
  const { toast } = useApp();
  const [answers, setAnswers] = useState({}); const [errors, setErrors] = useState([]);
  const qs = (c.questionnaire?.questions || []).filter(q => q.active !== false);
  const save = async () => {
    const miss = missingRequired(qs, answers); setErrors(miss);
    if (miss.length) { toast('Answer the required questions', 'error'); return; }
    try { await api(`/cases/${c.id}/paper`, { method: 'POST', body: { answers } }); toast('Paper form recorded'); onDone(); } catch (x) { toast(x.message, 'error'); }
  };
  return (
    <Modal wide title={`Enter paper form · ${c.employee.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}><Icon name="check" size={15} />Save form</button></>}>
      <div className="banner info small"><Icon name="note" size={16} />Use this only when the employee completed a printed form. It is recorded as entered by you, with the date and time.</div>
      {qs.length ? <Questions questions={qs} answers={answers} onChange={setAnswers} errors={errors} /> : <Loading />}
    </Modal>
  );
}

function PrintModal({ c, onClose, onPrint }) {
  const { can } = useApp();
  const [o, setO] = useState({ notes: false });
  return (
    <Modal title={`Exit interview record · ${c.ref}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onPrint(o)}><Icon name="print" size={15} />Print / Save as PDF</button></>}>
      <p className="small">An A4 record in the Bank’s red and black. Choose <b>Save as PDF</b> in the print dialog. Signature lines are replaced by the digital records.</p>
      {!c.confidential.responses && <div className="banner warn small"><Icon name="lock" size={16} />Your role does not include responses, so the record shows release and status details only.</div>}
      {can('notes', 'r') && <label className="check"><input type="checkbox" checked={o.notes} onChange={e => setO({ ...o, notes: e.target.checked })} /> Include confidential ER notes</label>}
    </Modal>
  );
}

export function Meetings() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/meetings').then(x => setD(x.meetings)).catch(() => setD([])); }, []);
  if (!d) return <main><Loading /></main>;
  const t = today();
  const up = d.filter(m => m.status === 'Scheduled').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const overdue = up.filter(m => m.date < t);
  const past = d.filter(m => m.status !== 'Scheduled').sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const tone = s => s === 'Held' ? 'green' : s === 'Scheduled' ? 'brand' : 'red';
  const Row = ({ m }) => (
    <Link className="item" to={`/hr/cases/${m.exit_id}`}>
      <span className="avatar" style={{ flexDirection: 'column', lineHeight: 1, fontSize: 11 }}>{fmtDate(m.date).split(' ')[1]}<b style={{ fontSize: 15 }}>{+m.date.slice(8)}</b></span>
      <span className="meta"><b>{m.name}</b><span>{m.time} · {m.mode} · {m.interviewer}{m.extra_participants ? ` · +${m.extra_participants} participant${m.extra_participants > 1 ? 's' : ''}` : ''}</span></span>
      <span className="end"><span className={`chip ${tone(m.status)}`}>{m.status === 'Held' ? (m.remarks ? 'Conducted' : 'Remarks due') : m.status}</span><span className="tiny muted">{m.case_ref}</span></span>
    </Link>
  );
  return (
    <main>
      <div className="page-head"><div><h1>ER meetings</h1><p>{up.length} upcoming · {past.filter(m => m.status === 'Held').length} conducted · {past.filter(m => m.status === 'No show').length} no-shows · {past.filter(m => m.status === 'Cancelled').length} cancelled</p></div></div>
      {overdue.length > 0 && <div className="banner warn" style={{ marginBottom: 14 }}><Icon name="alert" />{overdue.length} meeting{overdue.length > 1 ? 's are' : ' is'} past the date but still “Scheduled” — mark conducted or record a no-show.</div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="card"><div className="card-head"><h2>Upcoming</h2></div><div className="list">{up.map(m => <Row key={m.id} m={m} />)}{!up.length && <Empty icon="cal">No meetings booked.</Empty>}</div></section>
        <section className="card"><div className="card-head"><h2>Recent</h2></div><div className="list">{past.slice(0, 15).map(m => <Row key={m.id} m={m} />)}{!past.length && <Empty icon="cal">None yet.</Empty>}</div></section>
      </div>
    </main>
  );
}
