// ER case management. Confidential content is split by permission:
//   cases.r      case list, status, release details, history (no answers)
//   responses.r  the employee's answers and personal contact details
//   meetings.r   the mandatory ER meeting, participants and Meeting Remarks
//   notes.r      confidential ER notes
// Completing an exit needs: form submitted + meeting conducted + remarks.
// There is no approval step and no ER assessment.
import { Router } from 'express';
import { all, get, run, getSettings, audit } from '../db.js';
import { allow, allowAny, actorOf, can } from '../identity.js';
import { parseCase, loadCase, meetingsFor, recordEvent, STATUS_LABEL, sweep, completionBlocker } from '../services/workflow.js';
import { getVersion } from '../services/questionnaire.js';
import { normalize } from '../services/normalize.js';
import { notify } from '../services/notify.js';
import { outbound } from '../services/integrations.js';
import { submitForm, cleanAbout, RuleError } from '../services/releases.js';
import { h, bad, str, isDate } from './util.js';

export const casesRouter = Router();
const daysSince = d => d ? (Date.now() - new Date(String(d).replace(' ', 'T') + 'Z')) / 864e5 : 0;
const today = () => new Date().toISOString().slice(0, 10);

function nextAction(r, ms, s) {
  const w = s.workflow || {};
  if (r.withdrawn_at || r.closed_at || r.status === 'No response') return null;
  if (!r.submitted_at) return daysSince(r.reminder_at || r.released_at) >= (w.reminderAfterDays ?? 3) ? 'Reminder due' : null;
  const sched = ms.filter(m => m.status === 'Scheduled');
  if (sched.some(m => m.date < today())) return 'Record meeting outcome';
  if (sched.length) return null;
  const held = ms.filter(m => m.status === 'Held');
  if (held.length) return held.some(m => m.remarks) ? 'Ready to complete exit' : 'Record meeting remarks';
  if (ms.some(m => ['No show', 'Cancelled'].includes(m.status))) return 'Reschedule ER meeting';
  return daysSince(r.submitted_at) >= (w.overdueAfterDays ?? 7) ? 'Overdue — schedule ER meeting' : 'Schedule ER meeting';
}

casesRouter.get('/staff/er', allowAny(['cases', 'u'], ['meetings', 'c']), h((req, res) => {
  const users = all(`SELECT u.id, u.name, u.email, u.persona, r.name AS role, r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 ORDER BY u.persona, r.sort, u.name`)
    .map(({ permissions, ...u }) => { const p = JSON.parse(permissions); return { ...u, er: !!(p.cases?.u || p.meetings?.c) }; });
  // er = can process cases (ER officers / interviewers); everyone else can be added as a participant.
  res.json({ users: users.filter(u => u.er), people: users });
}));

casesRouter.get('/cases', allow('cases', 'r'), h((req, res) => {
  sweep();
  const s = getSettings(); const seeAnswers = can(req.user, 'responses', 'r');
  const ms = all('SELECT * FROM meetings');
  const users = Object.fromEntries(all('SELECT id, name FROM users').map(u => [u.id, u.name]));
  const rows = all('SELECT * FROM exit_interviews ORDER BY COALESCE(submitted_at, released_at) DESC, id DESC').map(parseCase).map(r => {
    const m = ms.filter(x => x.exit_id === r.id);
    return {
      id: r.id, ref: r.ref, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status, name: r.name, employee_uid: r.employee_uid, job_title: r.job_title,
      division: r.division, department: r.department, last_day: r.last_day, released_at: r.released_at, submitted_at: r.submitted_at, closed_at: r.closed_at,
      withdrawn: !!r.withdrawn_at, assigned_to: r.assigned_to, assignee: users[r.assigned_to] || null,
      rating: seeAnswers && r.submitted_at ? normalize(r).overall : undefined,
      nextMeeting: m.filter(x => x.status === 'Scheduled').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null,
      lastMeetingStatus: m.length ? m[m.length - 1].status : null,
      hasRemarks: m.some(x => x.remarks), action: nextAction(r, m, s),
    };
  });
  res.json({ cases: rows, me: req.user.id });
}));

casesRouter.get('/cases/:id', allow('cases', 'r'), h((req, res) => {
  const r = loadCase(req.params.id);
  if (!r) return bad(res, 'Not found', 404);
  const u = req.user; const s = getSettings();
  const out = {
    id: r.id, ref: r.ref, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status, source: r.source,
    employee: { name: r.name, employee_uid: r.employee_uid, job_title: r.job_title, division: r.division, department: r.department, unit: r.unit, line_manager: r.line_manager },
    release: { exit_type: r.exit_type, notice_date: r.notice_date, last_day: r.last_day, note_to_staff: r.note_to_staff, released_by: r.released_by, released_at: r.released_at,
      acknowledged_at: r.acknowledged_at, link_expires_at: r.link_expires_at, withdrawn_at: r.withdrawn_at, withdrawn_reason: r.withdrawn_reason },
    form_started_at: r.form_started_at, submitted_at: r.submitted_at, entered_by: r.entered_by,
    closed_at: r.closed_at, completion_blocker: completionBlocker(r), assigned_to: r.assigned_to,
    assignee: r.assigned_to ? get('SELECT id, name FROM users WHERE id = ?', [r.assigned_to]) : null,
    action: nextAction(r, meetingsFor(r.id), s),
    access_link: can(u, 'releases', 'r') || can(u, 'cases', 'u') ? `/exit/${r.access_code}` : undefined,
    history: all('SELECT id, at, event, from_status, to_status, actor_name, actor_id, actor_role, detail, simulated FROM workflow_events WHERE exit_id = ? ORDER BY id', [r.id]),
    records: all('SELECT id, at, action, actor_name, actor_id, actor_role, status, comment, source, simulated FROM acknowledgements WHERE exit_id = ? ORDER BY id', [r.id]),
    confidential: { responses: can(u, 'responses', 'r'), meetings: can(u, 'meetings', 'r'), notes: can(u, 'notes', 'r') },
  };
  if (can(u, 'responses', 'r')) {
    const qn = getVersion(r.questionnaire_version);
    out.questionnaire = { version: qn.version, name: qn.name, questions: qn.questions };
    out.answers = r.answers;
    out.summary = r.submitted_at ? normalize(r) : null;
    out.contact = { personal_email: r.personal_email, mobile: r.mobile, contact_method: r.contact_method };
    audit(actorOf(req), 'responses', 'View', r.ref, 'Opened confidential responses');
  }
  if (can(u, 'meetings', 'r')) out.meetings = meetingsFor(r.id).map(m => meetingView(m, r));
  if (can(u, 'notes', 'r')) out.notes = all('SELECT * FROM notes WHERE exit_id = ? ORDER BY created_at DESC, id DESC', [r.id]);
  res.json({ case: out });
}));

const caseOr404 = (req, res) => { const r = loadCase(req.params.id); if (!r) bad(res, 'Not found', 404); return r; };
const openOnly = r => { if (r.withdrawn_at) throw new RuleError('This release was withdrawn.', 409); };

casesRouter.post('/cases/:id/assign', allow('cases', 'u'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return; openOnly(r);
  const to = get(`SELECT u.id, u.name, r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.active = 1`, [Number(req.body?.userId)]);
  if (!to || !JSON.parse(to.permissions).cases?.u) return bad(res, 'Choose an ER team member who can process cases.');
  run('UPDATE exit_interviews SET assigned_to = ? WHERE id = ?', [to.id, r.id]);
  recordEvent(r.id, 'case.assigned', actorOf(req), { auditAction: 'Edit', detail: `Assigned to ${to.name}` });
  notify('case.assigned', loadCase(r.id), { actor: actorOf(req) });
  res.json({ ok: true });
}));

casesRouter.post('/cases/:id/no-response', allow('cases', 'u'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return; openOnly(r);
  if (r.submitted_at) return bad(res, 'The form is already submitted.', 409);
  run(`UPDATE exit_interviews SET status = 'No response' WHERE id = ?`, [r.id]);
  recordEvent(r.id, 'no_response', actorOf(req), { auditAction: 'Edit', detail: 'Marked as no response', forceStatus: 'No response' });
  res.json({ ok: true });
}));

// Complete Exit — the assigned ER officer (or any role with Exit cases → Edit)
// completes the exit directly once the mandatory steps are done.
casesRouter.post('/cases/:id/complete', allow('cases', 'u'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return;
  const why = completionBlocker(r);
  if (why) throw new RuleError(why, 409);
  const actor = actorOf(req);
  run(`UPDATE exit_interviews SET closed_at = datetime('now'), closure_requested_at = NULL WHERE id = ?`, [r.id]);
  run(`UPDATE employees SET status = 'Exited' WHERE employee_id = ?`, [r.employee_uid]);
  recordEvent(r.id, 'case.closed', actor, { auditAction: 'Complete', detail: 'Exit completed', ack: { action: 'Exit completed' } });
  const fresh = loadCase(r.id);
  notify('case.closed', fresh, { actor });
  outbound('exit.case.closed', fresh, { status: 'CLOSED', closedAt: fresh.closed_at });
  res.json({ ok: true, completed_at: fresh.closed_at });
}));

casesRouter.post('/cases/:id/reopen', allow('cases', 'u'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return; openOnly(r);
  const reason = str(req.body?.reason, 300);
  if (!reason) return bad(res, 'Give a reason for reopening.');
  run(`UPDATE exit_interviews SET closed_at = NULL, status = CASE WHEN status = 'No response' THEN 'Released' ELSE status END WHERE id = ?`, [r.id]);
  recordEvent(r.id, 'case.reopened', actorOf(req), { auditAction: 'Edit', detail: `Exit reopened: ${reason}` });
  res.json({ ok: true });
}));

casesRouter.post('/cases/:id/paper', allow('cases', 'c'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return; openOnly(r);
  submitForm(r, actorOf(req), req.body?.answers || {}, cleanAbout(req.body?.about), { enteredBy: req.user.name });
  res.json({ ok: true });
}));

casesRouter.post('/cases/:id/record-generated', allow('cases', 'r'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return;
  const parts = [can(req.user, 'responses', 'r') && 'responses', can(req.user, 'meetings', 'r') && 'meeting remarks', req.body?.notes && can(req.user, 'notes', 'r') && 'ER notes'].filter(Boolean);
  recordEvent(r.id, 'record.generated', actorOf(req), { auditAction: 'Print', detail: `Exit interview record generated (${parts.join(', ') || 'status only'})` });
  res.json({ ok: true, at: new Date().toISOString() });
}));

// ---------------------------------------------------------------- meetings
// The ER exit interview meeting is mandatory. Participants: the employee and
// the responsible ER officer (interviewer) are always included; ER can add
// configured users or other people by name. One Meeting Remarks text box;
// the meeting reference, recorder, date, time and audit entry are automatic.
const MODES = ['In person', 'Microsoft Teams', 'Phone'];
const interviewerOf = id => get(`SELECT u.id, u.name FROM users u WHERE u.id = ? AND u.active = 1`, [Number(id)]);
const extrasOf = meetingId => all('SELECT id, user_id, name, email, role, added_by, added_at FROM meeting_participants WHERE meeting_id = ? ORDER BY id', [meetingId]);

export function meetingView(m, r) {
  return {
    ...m,
    participants: [
      { required: true, kind: 'employee', name: r.name, role: 'Employee' },
      { required: true, kind: 'officer', user_id: m.interviewer_id, name: m.interviewer, role: 'ER officer' },
      ...extrasOf(m.id).filter(p => p.user_id !== m.interviewer_id).map(p => ({ ...p, required: false, kind: p.user_id ? 'user' : 'external' })),
    ],
  };
}

// Input: [{ userId }] or [{ name, email }]. Returns clean rows (duplicates and required people removed).
function cleanParticipants(list, interviewerId) {
  if (!Array.isArray(list)) return null;
  const out = []; const seen = new Set();
  for (const p of list.slice(0, 30)) {
    if (p?.userId) {
      const u = get(`SELECT u.id, u.name, u.email, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.active = 1`, [Number(p.userId)]);
      if (!u || u.id === Number(interviewerId) || seen.has(`u${u.id}`)) continue;
      seen.add(`u${u.id}`); out.push({ user_id: u.id, name: u.name, email: u.email, role: u.role });
    } else {
      const name = str(p?.name, 120); const email = str(p?.email, 200);
      if (!name) continue;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new RuleError(`Check the email for ${name}.`);
      const k = `n${name.toLowerCase()}`; if (seen.has(k)) continue;
      seen.add(k); out.push({ user_id: null, name, email, role: str(p?.role, 80) });
    }
  }
  return out;
}
function saveParticipants(meetingId, list, by) {
  const before = extrasOf(meetingId);
  const key = p => p.user_id ? `u${p.user_id}` : `n${String(p.name).toLowerCase()}`;
  const keep = new Set(list.map(key)); const had = new Set(before.map(key));
  before.filter(p => !keep.has(key(p))).forEach(p => run('DELETE FROM meeting_participants WHERE id = ?', [p.id]));
  const added = list.filter(p => !had.has(key(p)));
  added.forEach(p => run('INSERT INTO meeting_participants (meeting_id, user_id, name, email, role, added_by) VALUES (?,?,?,?,?,?)', [meetingId, p.user_id, p.name, p.email, p.role, by]));
  return { added, removed: before.filter(p => !keep.has(key(p))) };
}
const names = l => l.map(p => p.name).join(', ');

casesRouter.get('/meetings', allow('meetings', 'r'), h((req, res) => {
  res.json({ meetings: all(`SELECT m.*, e.ref AS case_ref, e.name, e.division, e.last_day, e.assigned_to,
      (SELECT COUNT(*) FROM meeting_participants p WHERE p.meeting_id = m.id AND (p.user_id IS NULL OR p.user_id != m.interviewer_id)) AS extra_participants
    FROM meetings m JOIN exit_interviews e ON e.id = m.exit_id WHERE e.withdrawn_at IS NULL ORDER BY m.date, m.time`) });
}));

casesRouter.post('/cases/:id/meetings', allow('meetings', 'c'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return; openOnly(r);
  if (r.closed_at) return bad(res, 'The exit is already completed.', 409);
  if (!r.submitted_at) return bad(res, 'Schedule the ER meeting after the employee submits the exit form.', 409);
  if (meetingsFor(r.id).some(m => m.status === 'Scheduled')) return bad(res, 'An ER meeting is already scheduled. Reschedule it instead.', 409);
  const b = req.body || {}; const iv = interviewerOf(b.interviewerId);
  if (!isDate(b.date) || !/^\d{2}:\d{2}$/.test(b.time || '') || !MODES.includes(b.mode) || !iv) return bad(res, 'Date, time, format and ER officer are required.');
  const extras = cleanParticipants(b.participants || [], iv.id);
  const n = get('SELECT COUNT(*) AS n FROM meetings WHERE exit_id = ?', [r.id]).n + 1;
  const { id } = run(`INSERT INTO meetings (exit_id, ref, date, time, mode, location, interviewer, interviewer_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    [r.id, `${r.ref}/M${n}`, b.date, b.time, b.mode, str(b.location), iv.name, iv.id, req.user.name]);
  saveParticipants(id, extras, req.user.name);
  recordEvent(r.id, 'meeting.scheduled', actorOf(req), { module: 'meetings', auditAction: 'Create',
    detail: `ER meeting ${r.ref}/M${n} on ${b.date} ${b.time} (${b.mode}) with ${iv.name}${extras.length ? `; participants: ${names(extras)}` : ''}` });
  notify('meeting.scheduled', loadCase(r.id), { meeting: get('SELECT * FROM meetings WHERE id = ?', [id]), participants: extras });
  res.status(201).json({ ok: true, id });
}));

// Reschedule, change participants, cancel or record a no-show.
casesRouter.put('/meetings/:id', allow('meetings', 'u'), h((req, res) => {
  const m = get('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
  if (!m) return bad(res, 'Not found', 404);
  const r = loadCase(m.exit_id); openOnly(r);
  if (r.closed_at) return bad(res, 'The exit is already completed.', 409);
  const b = req.body || {};
  if (m.status !== 'Scheduled') return bad(res, 'Only a scheduled meeting can be changed.', 409);
  if (b.status === 'Cancelled' || b.status === 'No show') {
    run(`UPDATE meetings SET status = ?, updated_at = datetime('now') WHERE id = ?`, [b.status, m.id]);
    recordEvent(m.exit_id, b.status === 'Cancelled' ? 'meeting.cancelled' : 'meeting.no_show', actorOf(req), { module: 'meetings', auditAction: 'Edit',
      detail: `ER meeting ${m.ref || m.date} ${b.status === 'Cancelled' ? 'cancelled' : 'marked no-show'}${b.reason ? `: ${str(b.reason, 200)}` : ''} — a new meeting is required to complete the exit`,
      ack: b.status === 'No show' ? { action: 'ER meeting no-show recorded', comment: `Meeting ${m.date} ${m.time}` } : null });
    if (b.status === 'Cancelled') notify('meeting.changed', loadCase(m.exit_id), { meeting: { ...m, status: 'Cancelled' }, participants: extrasOf(m.id) });
    return res.json({ ok: true });
  }
  const n = { date: b.date || m.date, time: b.time || m.time, mode: b.mode || m.mode, location: b.location !== undefined ? str(b.location) : m.location };
  const iv = b.interviewerId ? interviewerOf(b.interviewerId) : { id: m.interviewer_id, name: m.interviewer };
  if (!isDate(n.date) || !/^\d{2}:\d{2}$/.test(n.time) || !MODES.includes(n.mode) || !iv) return bad(res, 'Check the meeting details.');
  const moved = n.date !== m.date || n.time !== m.time || n.mode !== m.mode || (n.location || null) !== (m.location || null) || iv.id !== m.interviewer_id;
  if (moved) run(`UPDATE meetings SET date=?, time=?, mode=?, location=?, interviewer=?, interviewer_id=?, updated_at=datetime('now') WHERE id=?`, [n.date, n.time, n.mode, n.location, iv.name, iv.id, m.id]);
  const extras = cleanParticipants(b.participants, iv.id);
  const pc = extras ? saveParticipants(m.id, extras, req.user.name) : { added: [], removed: [] };
  if (moved) {
    recordEvent(m.exit_id, 'meeting.changed', actorOf(req), { module: 'meetings', auditAction: 'Edit', detail: `ER meeting moved from ${m.date} ${m.time} to ${n.date} ${n.time} (${n.mode}, ${iv.name})` });
    notify('meeting.changed', loadCase(m.exit_id), { meeting: get('SELECT * FROM meetings WHERE id = ?', [m.id]), participants: extrasOf(m.id) });
  }
  if (pc.added.length || pc.removed.length) {
    recordEvent(m.exit_id, 'meeting.participants', actorOf(req), { module: 'meetings', auditAction: 'Edit',
      detail: [pc.added.length && `Participants added: ${names(pc.added)}`, pc.removed.length && `removed: ${names(pc.removed)}`].filter(Boolean).join('; ') });
    if (!moved && pc.added.length) notify('meeting.scheduled', loadCase(m.exit_id), { meeting: get('SELECT * FROM meetings WHERE id = ?', [m.id]), participants: pc.added.filter(p => p.user_id), onlyParticipants: true });
  }
  res.json({ ok: true });
}));

// Mark the meeting as conducted (the only outcome that can lead to Complete Exit).
casesRouter.post('/meetings/:id/conducted', allow('meetings', 'u'), h((req, res) => {
  const m = get('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
  if (!m) return bad(res, 'Not found', 404);
  const r = loadCase(m.exit_id); openOnly(r);
  if (r.closed_at) return bad(res, 'The exit is already completed.', 409);
  if (!['Scheduled', 'No show'].includes(m.status)) return bad(res, m.status === 'Held' ? 'This meeting is already marked as conducted.' : 'This meeting was cancelled.', 409);
  run(`UPDATE meetings SET status = 'Held', conducted_at = datetime('now'), conducted_by = ?, updated_at = datetime('now') WHERE id = ?`, [req.user.name, m.id]);
  recordEvent(m.exit_id, 'meeting.held', actorOf(req), { module: 'meetings', auditAction: 'Edit', detail: `ER meeting ${m.ref || m.date} conducted`,
    ack: { action: 'ER meeting conducted', comment: `Meeting ${m.date} ${m.time}` } });
  res.json({ ok: true });
}));

// Meeting Remarks — one text box. Recorder, date and time are captured automatically.
casesRouter.post('/meetings/:id/remarks', allow('meetings', 'u'), h((req, res) => {
  const m = get('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
  if (!m) return bad(res, 'Not found', 404);
  const r = loadCase(m.exit_id); openOnly(r);
  if (r.closed_at) return bad(res, 'The exit is already completed; remarks are locked.', 409);
  if (m.status !== 'Held') return bad(res, 'Mark the meeting as conducted before recording remarks.', 409);
  const remarks = str(req.body?.remarks, 10000);
  if (!remarks) return bad(res, 'Write the meeting remarks first.');
  const editing = !!m.remarks;
  run(`UPDATE meetings SET remarks = ?, minutes_by = ?, minutes_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [remarks, req.user.name, m.id]);
  recordEvent(m.exit_id, 'meeting.remarks', actorOf(req), { module: 'meetings', auditAction: editing ? 'Edit' : 'Create',
    detail: `Meeting remarks ${editing ? 'updated' : 'recorded'} (${m.ref || m.date})`,
    ack: { action: editing ? 'Meeting remarks updated' : 'Meeting remarks recorded', comment: m.ref || null } });
  res.json({ ok: true });
}));

casesRouter.delete('/meetings/:id', allow('meetings', 'd'), h((req, res) => {
  const m = get('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
  if (!m) return bad(res, 'Not found', 404);
  if (m.status !== 'Scheduled' || m.remarks || m.discussion) return bad(res, 'Only a scheduled meeting without a record can be deleted. Cancel it instead.', 409);
  run('DELETE FROM meeting_participants WHERE meeting_id = ?', [m.id]);
  run('DELETE FROM meetings WHERE id = ?', [m.id]);
  recordEvent(m.exit_id, 'meeting.deleted', actorOf(req), { module: 'meetings', auditAction: 'Delete', detail: `Meeting entry ${m.ref || ''} ${m.date} ${m.time} deleted` });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- notes (confidential)
casesRouter.post('/cases/:id/notes', allow('notes', 'c'), h((req, res) => {
  const r = caseOr404(req, res); if (!r) return;
  const body = str(req.body?.body, 4000);
  if (!body) return bad(res, 'Write a note first.');
  run('INSERT INTO notes (exit_id, body, created_by) VALUES (?,?,?)', [r.id, body, req.user.name]);
  recordEvent(r.id, 'note.added', actorOf(req), { module: 'notes', auditAction: 'Create', detail: 'Confidential ER note added' });
  res.status(201).json({ ok: true });
}));
casesRouter.put('/notes/:id', allow('notes', 'u'), h((req, res) => {
  const n = get('SELECT * FROM notes WHERE id = ?', [req.params.id]);
  const body = str(req.body?.body, 4000);
  if (!n) return bad(res, 'Not found', 404);
  if (!body) return bad(res, 'The note cannot be empty.');
  run(`UPDATE notes SET body = ?, updated_at = datetime('now') WHERE id = ?`, [body, n.id]);
  recordEvent(n.exit_id, 'note.edited', actorOf(req), { module: 'notes', auditAction: 'Edit', detail: 'Confidential ER note edited' });
  res.json({ ok: true });
}));
casesRouter.delete('/notes/:id', allow('notes', 'd'), h((req, res) => {
  const n = get('SELECT * FROM notes WHERE id = ?', [req.params.id]);
  if (!n) return bad(res, 'Not found', 404);
  run('DELETE FROM notes WHERE id = ?', [n.id]);
  recordEvent(n.exit_id, 'note.deleted', actorOf(req), { module: 'notes', auditAction: 'Delete', detail: 'Confidential ER note deleted' });
  res.json({ ok: true });
}));
