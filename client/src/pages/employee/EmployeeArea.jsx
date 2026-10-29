// Employee experience: My Release (with status) · Acknowledgement · Exit
// Interview Form · My Meeting. Used in-app (/me) and through the
// employee-specific link (/exit/:code), which needs no HR access.
// The form shows the original ExitBuddy questions first and "How do we reach
// out to you?" last. The ER meeting is part of the exit process — employees
// are not asked whether they want one.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import Questions, { missingRequired, visibleCount } from '../../components/Questions.jsx';
import { DigitalRecords } from '../../components/Records.jsx';
import { ErrorBox, Fold, Loading, Empty } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { fmtDate, fmtDateTime, fmtTime, tzLabel } from '../../lib/format.js';

function useRelease(base) {
  const [rel, setRel] = useState(null); const [err, setErr] = useState(null);
  const load = useCallback(() => api(base).then(d => { setRel(d.release); setErr(null); }).catch(e => setErr(e)), [base]);
  useEffect(() => { load(); }, [load]);
  return { rel, err, load };
}

function Steps({ rel }) {
  const items = [
    ['Acknowledge release', rel.acknowledged || !rel.requireAck],
    ['Exit interview form', !!rel.submitted_at],
    ['ER meeting', rel.meetings.some(m => m.status === 'Held')],
    ['Exit completed', rel.status === 'Closed'],
  ];
  const now = items.findIndex(x => !x[1]);
  return <div className="steps" style={{ marginTop: 14 }}>{items.map(([l, done], i) => <div key={l} className={`step ${done ? 'done' : i === now ? 'now' : ''}`}>Step {i + 1}<b>{l}</b></div>)}</div>;
}

function Hero({ rel }) {
  return (
    <section className="hero" style={{ marginBottom: 16 }}>
      <span className="chip mono">{rel.ref}</span><h1 style={{ marginTop: 8 }}>Hi {String(rel.about.name).split(' ')[0]}, thank you for your time with us</h1>
      <p style={{ marginTop: 6 }}>Last working day <b>{fmtDate(rel.release.last_day)}</b> · Status: <b>{rel.statusLabel}</b></p>
      <Steps rel={rel} />
    </section>
  );
}

function MyRelease({ rel, to }) {
  const next = rel.status === 'Withdrawn' ? null : !rel.acknowledged && rel.requireAck ? ['acknowledgement', 'Acknowledge your release'] : !rel.submitted_at && !rel.locked ? ['form', rel.form_started_at ? 'Continue your exit interview form' : 'Start your exit interview form'] : null;
  const meeting = rel.meetings.find(m => m.status === 'Scheduled');
  return (
    <div className="stack" style={{ gap: 14, maxWidth: 820 }}>
      <section className="card stack">
        {rel.status === 'Withdrawn' && <div className="banner warn"><Icon name="alert" />This release was withdrawn. You do not need to complete the exit form.</div>}
        {rel.status === 'Closed' && <div className="banner ok"><Icon name="check" /><div><b>Your exit is complete.</b> Completed {fmtDateTime(rel.completed_at)}. Thank you.</div></div>}
        <dl className="kv">
          <dt>Exit type</dt><dd>{rel.release.exit_type}</dd><dt>Last working day</dt><dd>{fmtDate(rel.release.last_day)}</dd>
          <dt>Acknowledgement</dt><dd>{rel.acknowledged ? fmtDateTime(rel.acknowledged_at) : rel.acknowledgementSource === 'oneui' ? 'In OneUI' : 'Pending'}</dd>
          <dt>Exit form</dt><dd>{rel.submitted_at ? `Submitted ${fmtDateTime(rel.submitted_at)}` : rel.form_started_at ? 'In progress' : 'Not started'}</dd>
          <dt>ER meeting</dt><dd>{meeting ? `${fmtDate(meeting.date)} · ${meeting.time}` : rel.meetings.some(m => m.status === 'Held') ? 'Conducted' : rel.submitted_at ? 'To be scheduled by the ER team' : 'After your form'}</dd>
        </dl>
        {rel.release.note_to_staff && <div className="banner info"><Icon name="note" />{rel.release.note_to_staff}</div>}
        {next && <Link className="btn primary" style={{ justifyContent: 'center' }} to={to(next[0])}><Icon name="right" size={16} />{next[1]}</Link>}
      </section>
      <div className="stack" style={{ gap: 8 }}>
        <Fold title="Your digital confirmations" sub={`${rel.records.length} recorded`}><DigitalRecords compact records={rel.records} /></Fold>
        <Fold title="Progress" sub={rel.timeline.length ? `Last update ${fmtDateTime(rel.timeline[rel.timeline.length - 1].at)}` : ''}>
          <ul className="timeline">{[...rel.timeline].reverse().map((t, i) => <li key={i}><b>{t.label}</b><div className="tiny muted">{fmtDateTime(t.at)}</div></li>)}</ul>
        </Fold>
        <Fold title="Messages to you" sub={`${rel.messages.length} · simulated in this test environment`}>
          {rel.messages.length ? <div className="stack" style={{ gap: 8 }}>{rel.messages.map((m, i) => (
            <div key={i} className="note"><div className="by">{fmtDateTime(m.at)} · {m.channel} · {m.status === 'Simulated' ? 'Simulated (not sent)' : m.status}</div><b>{m.title}</b>{'\n'}{m.body}</div>
          ))}</div> : <p className="muted small">No messages.</p>}
        </Fold>
      </div>
    </div>
  );
}

function Acknowledgement({ rel, base, reload }) {
  const { config, toast } = useApp();
  const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  if (rel.acknowledgementSource === 'oneui') return <section className="card stack"><h2>Release acknowledgement</h2><div className="banner info"><Icon name="plug" />Your release acknowledgement is recorded in OneUI, which is the official record.</div>{rel.acknowledged && <p>Acknowledged {fmtDateTime(rel.acknowledged_at)}.</p>}</section>;
  return (
    <section className="card stack" style={{ maxWidth: 820 }}>
      <h2>Staff release acknowledgement</h2>
      <p>The {config.companyName} confirms your {String(rel.release.exit_type).toLowerCase()}{rel.release.notice_date ? <> dated <b>{fmtDate(rel.release.notice_date)}</b></> : null}. Your last working day is <b>{fmtDate(rel.release.last_day)}</b>.</p>
      <p>Please acknowledge your release below. Completing the exit interview form and attending the ER exit interview meeting are <b>required</b> as part of your release process.</p>
      {rel.acknowledged ? <DigitalRecords compact records={rel.records.filter(r => r.action === 'Release acknowledged')} /> : (
        <>
          <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> I acknowledge receipt of my release and confirm my last working day is {fmtDate(rel.release.last_day)}.</label>
          <p className="tiny muted">Your name, employee ID, the date and the time are recorded automatically. You do not need to sign.</p>
          <div className="btns"><button className="btn primary" disabled={!ok || busy} onClick={async () => { setBusy(true); try { await api(`${base}/acknowledge`, { method: 'POST' }); toast('Release acknowledged'); await reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }}><Icon name="check" size={16} />Acknowledge release</button></div>
        </>
      )}
    </section>
  );
}

function ExitForm({ rel, base, reload, to }) {
  const { config, toast, confirm } = useApp();
  const nav = useNavigate();
  const [answers, setAnswers] = useState(rel.answers || {});
  const [contact, setContact] = useState({ personal_email: rel.contact.personal_email || '', mobile: rel.contact.mobile || '', contact_method: rel.contact.contact_method || '' });
  const [errors, setErrors] = useState([]); const [saved, setSaved] = useState(null); const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const qs = rel.questionnaire.questions;
  const save = useCallback(async (silent) => {
    try { await api(`${base}/draft`, { method: 'PUT', body: { answers, about: contact } }); dirty.current = false; setSaved(new Date()); if (!silent) toast('Saved — you can come back and continue later'); }
    catch (e) { if (!silent) toast(e.message, 'error'); }
  }, [answers, contact, base, toast]);
  useEffect(() => { if (!dirty.current) return; const t = setTimeout(() => save(true), 1800); return () => clearTimeout(t); }, [answers, contact, save]);

  if (rel.status === 'Withdrawn') return <Empty icon="alert">This release was withdrawn.</Empty>;
  if (rel.requireAck && !rel.acknowledged) return <section className="card stack"><h2>Exit interview form</h2><p>Please acknowledge your release first.</p><Link className="btn primary" to={to('acknowledgement')}>Go to acknowledgement</Link></section>;
  if (rel.submitted_at) return <section className="card stack" style={{ maxWidth: 720 }}><div className="banner ok"><Icon name="check" /><div><b>Your exit interview form is submitted</b><br />{fmtDateTime(rel.submitted_at)} · reference <span className="mono">{rel.ref}</span></div></div><p className="small">Your answers are locked and visible only to the Employee Relations team. The ER team will schedule your exit interview meeting.</p><Link className="btn" to={to('meeting')}><Icon name="cal" size={15} />My meeting</Link></section>;
  if (rel.locked) return <div className="banner warn"><Icon name="alert" />This exit form is no longer open. Please contact the Employee Relations team.</div>;
  const { total, answered } = visibleCount(qs, answers);
  const setC = (k, v) => { dirty.current = true; setContact({ ...contact, [k]: v }); };
  const submit = async () => {
    const miss = missingRequired(qs, answers); setErrors(miss);
    if (miss.length) { document.getElementById(`q-${miss[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast(`Please answer ${miss.length} required question${miss.length > 1 ? 's' : ''}`, 'error'); return; }
    if (!await confirm({ title: 'Submit your exit interview?', body: 'After you submit, your answers are locked. The date and time are recorded automatically.', confirmLabel: 'Submit' })) return;
    setBusy(true);
    try { await api(`${base}/submit`, { method: 'POST', body: { answers, about: contact } }); toast('Thank you — your exit interview is submitted'); await reload(); nav(to('')); window.scrollTo(0, 0); }
    catch (e) { if (e.data?.fields) setErrors(e.data.fields); toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="split">
      <div className="stack" style={{ gap: 14 }}>
        <section className="card flat about-strip" aria-label="Your details (from your HR record)">
          {config.aboutFields.map(f => <div key={f.key}><small>{f.label}</small><b>{(f.type === 'date' ? fmtDate(rel.about[f.key]) : rel.about[f.key]) || '—'}</b></div>)}
        </section>
        <section className="card">
          <div className="row between" style={{ marginBottom: 2 }}><h2>Exit interview</h2><span className="tiny muted"><span style={{ color: 'var(--red)' }}>*</span> required</span></div>
          <Questions questions={qs} answers={answers} errors={errors} onChange={a => { dirty.current = true; setAnswers(a); if (errors.length) setErrors(missingRequired(qs, a).filter(k => errors.includes(k))); }} />
        </section>
        <section className="card">
          <h2>How do we reach out to you?</h2>
          <p className="small muted" style={{ margin: '2px 0 12px' }}>For your experience letter and final settlement after you leave.</p>
          <div className="fields">
            {config.contactFields.map(f => (
              <label className="field" key={f.key}>{f.label}
                {f.type === 'select' ? <select value={contact[f.key] || ''} onChange={e => setC(f.key, e.target.value)}><option value="">Choose…</option>{f.options.map(o => <option key={o}>{o}</option>)}</select>
                  : <input type={f.type || 'text'} value={contact[f.key] || ''} onChange={e => setC(f.key, e.target.value)} />}
              </label>
            ))}
          </div>
        </section>
      </div>
      <aside className="stack" style={{ position: 'sticky', top: 76 }}>
        <div className="card stack">
          <h3>Your progress</h3>
          <div className="progress"><i style={{ width: `${total ? Math.round((answered / total) * 100) : 0}%` }} /></div>
          <p className="small muted">{answered} of {total} answered{saved ? ` · saved ${fmtTime(saved.toISOString())} ${tzLabel()}` : ''}</p>
          <div className="btns"><button className="btn" onClick={() => save(false)}>Save for later</button><button className="btn primary" disabled={busy} onClick={submit}><Icon name="send" size={16} />Submit</button></div>
        </div>
        <div className="banner info small"><Icon name="lock" size={16} />Only the Employee Relations team can read your answers. Your manager and Recruitment do not see them.</div>
      </aside>
    </div>
  );
}

function MyMeeting({ rel }) {
  const up = rel.meetings.filter(m => m.status === 'Scheduled');
  const held = rel.meetings.filter(m => m.status === 'Held');
  return (
    <section className="card stack" style={{ maxWidth: 720 }}>
      <h2>Your exit interview meeting</h2>
      <p className="small muted">A meeting with the Employee Relations team is part of your exit process.</p>
      {up.map(m => <div key={m.id} className="hero" style={{ padding: 18 }}><p className="small">{m.mode}</p><h2 style={{ margin: '4px 0' }}>{fmtDate(m.date)} · {m.time}</h2><p>{m.location ? `${m.location} · ` : ''}with {m.interviewer}</p></div>)}
      {!up.length && held.length > 0 && <div className="banner ok"><Icon name="check" />Your meeting took place on {fmtDate(held[0].date)}. Thank you for your time.</div>}
      {!up.length && !held.length && <Empty icon="cal">{rel.submitted_at ? 'The ER team will schedule your meeting and it will appear here.' : 'Your meeting is scheduled after you submit your exit interview form.'}</Empty>}
    </section>
  );
}

export function EmployeeRoutes({ base, prefix, link }) {
  const { rel, err, load } = useRelease(base);
  const to = p => p ? `${prefix}/${p}` : prefix;
  if (err) return <main style={{ maxWidth: 720 }}><ErrorBox error={err.message} />{link && <p style={{ marginTop: 12 }}><Link to="/">Back</Link></p>}</main>;
  if (!rel) return <main><Loading /></main>;
  return (
    <main style={{ maxWidth: 1080 }}>
      <Hero rel={rel} />
      {link && (
        <div className="tabs" role="tablist">
          {[['', 'My Release'], ['acknowledgement', 'Acknowledgement'], ['form', 'Exit Interview Form'], ['meeting', 'My Meeting']].map(([p, l]) =>
            <NavLink key={p} end to={to(p)} role="tab" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>{l}</NavLink>)}
        </div>
      )}
      <Routes>
        <Route index element={<MyRelease rel={rel} to={to} />} />
        <Route path="acknowledgement" element={<Acknowledgement rel={rel} base={base} reload={load} />} />
        <Route path="form" element={<ExitForm rel={rel} base={base} reload={load} to={to} />} />
        <Route path="meeting" element={<MyMeeting rel={rel} />} />
        <Route path="*" element={<Navigate to={prefix} replace />} />
      </Routes>
    </main>
  );
}

export function MyArea() {
  const { session } = useApp();
  if (session?.identity?.kind !== 'employee') return <Navigate to="/hr" replace />;
  return <EmployeeRoutes base="/me/release" prefix="/me" key={session.identity.employee.employeeId} />;
}

export function LinkArea() {
  const { code } = useParams();
  const { config } = useApp();
  return (
    <>
      <div className="confidential"><Icon name="lock" size={13} /> Confidential — your answers are read only by the Employee Relations team.</div>
      <header className="topbar"><div className="topbar-in"><span className="brand-mark"><Icon name="door" size={18} /></span><b className="title">{config.appName}</b><span className="spacer" /><span className="small muted">Employee link</span></div></header>
      <EmployeeRoutes base={`/public/exit/${encodeURIComponent(code)}`} prefix={`/exit/${code}`} link />
    </>
  );
}
