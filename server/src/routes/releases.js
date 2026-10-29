// Recruitment: employee lookup (mock HRIS), initiate / correct / withdraw
// releases, reminders and status tracking. Recruitment never receives
// interview answers or ER notes from these routes.
import { Router } from 'express';
import { all, get, run } from '../db.js';
import { allow, allowAny, actorOf } from '../identity.js';
import { parseCase, STATUS_LABEL, recordEvent, loadCase, sweep } from '../services/workflow.js';
import { createRelease, correctRelease, withdrawRelease, employeesFor, RuleError } from '../services/releases.js';
import { notify } from '../services/notify.js';
import { h, bad, str } from './util.js';

export const releasesRouter = Router();

// Only the details needed to identify the employee are returned (no grade or
// date of joining; those stay in the HR record for authorised integrations).
const EMP_VIEW = ({ employee_id, name, job_title, division, department, unit, line_manager, work_email, source }) => ({ employee_id, name, job_title, division, department, unit, line_manager, work_email, source });
releasesRouter.get('/employees', allowAny(['releases', 'c'], ['releases', 'r']), h((req, res) => {
  res.json({ employees: employeesFor(str(req.query.q, 80)).map(EMP_VIEW), source: 'Mock HRIS (future: MiHCM / approved HRIS endpoint)' });
}));
releasesRouter.get('/employees/:id', allowAny(['releases', 'c'], ['releases', 'r']), h((req, res) => {
  const e = get('SELECT * FROM employees WHERE employee_id = ?', [req.params.id]);
  if (!e) return bad(res, 'Employee not found', 404);
  res.json({ employee: EMP_VIEW(e), openRelease: get(`SELECT ref, status FROM exit_interviews WHERE employee_uid = ? AND withdrawn_at IS NULL AND closed_at IS NULL AND status != 'No response'`, [e.employee_id]) || null });
}));

const RELEASE_COLS = `id, ref, access_code, status, employee_uid, name, job_title, division, department, unit, line_manager, last_day, exit_type,
  notice_date, note_to_staff, released_by, released_at, acknowledged_at, form_started_at, submitted_at IS NOT NULL AS submitted, submitted_at, closed_at,
  withdrawn_at, withdrawn_reason, link_expires_at, reminder_at, source`;

releasesRouter.get('/releases', allow('releases', 'r'), h((req, res) => {
  sweep();
  const rows = all(`SELECT ${RELEASE_COLS} FROM exit_interviews ORDER BY released_at DESC, id DESC`).map(r => ({ ...r, statusLabel: STATUS_LABEL[r.status] || r.status }));
  const count = f => rows.filter(f).length;
  res.json({
    releases: rows,
    stats: {
      total: rows.length, active: count(r => !r.withdrawn_at && !r.closed_at && r.status !== 'No response'),
      awaitingAck: count(r => r.status === 'Released'), acknowledged: count(r => !!r.acknowledged_at && !r.withdrawn_at),
      formsIn: count(r => r.submitted), noResponse: count(r => r.status === 'No response'), withdrawn: count(r => !!r.withdrawn_at), closed: count(r => !!r.closed_at),
      byStatus: Object.fromEntries(Object.keys(STATUS_LABEL).map(s => [s, count(r => r.status === s)])),
    },
  });
}));

releasesRouter.get('/releases/:id', allow('releases', 'r'), h((req, res) => {
  const r = get(`SELECT ${RELEASE_COLS} FROM exit_interviews WHERE id = ?`, [req.params.id]);
  if (!r) return bad(res, 'Not found', 404);
  res.json({
    release: { ...r, statusLabel: STATUS_LABEL[r.status] },
    // Release-level history only — no interview content.
    history: all(`SELECT at, event, from_status, to_status, actor_name, actor_role, detail, simulated FROM workflow_events WHERE exit_id = ? AND event NOT LIKE 'note.%' ORDER BY id`, [r.id])
      .map(e => (e.event.startsWith('meeting.') || e.event.startsWith('case.')) ? { ...e, detail: e.to_status ? `Status: ${STATUS_LABEL[e.to_status] || e.to_status}` : null } : e),
    records: all('SELECT at, action, actor_name, actor_id, actor_role, status, comment, source, simulated FROM acknowledgements WHERE exit_id = ? AND action IN (?,?,?,?) ORDER BY id',
      [r.id, 'Release initiated', 'Release acknowledged', 'Release corrected', 'Release withdrawn']),
  });
}));

releasesRouter.post('/releases', allow('releases', 'c'), h((req, res) => {
  const e = get('SELECT * FROM employees WHERE employee_id = ?', [str(req.body?.employeeId, 40)]);
  if (!e) return bad(res, 'Choose an employee from the HRIS list.');
  if (!req.body?.confirmed) return bad(res, 'Confirm the release details first.');
  const r = createRelease({ employee: e, details: req.body.details || {}, actor: actorOf(req) });
  res.status(201).json({ id: r.id, ref: r.ref, access_code: r.access_code, link: `/exit/${r.access_code}`, link_expires_at: r.link_expires_at });
}));

releasesRouter.put('/releases/:id', allow('releases', 'u'), h((req, res) => {
  const r = loadCase(req.params.id);
  if (!r) return bad(res, 'Not found', 404);
  const reason = str(req.body?.reason, 300);
  if (!reason) throw new RuleError('Give a reason for the correction.');
  const out = correctRelease(r, req.body?.changes || {}, actorOf(req), reason);
  res.json({ ok: true, changed: out.changed });
}));

releasesRouter.post('/releases/:id/withdraw', allowAny(['releases', 'd'], ['cases', 'd']), h((req, res) => {
  const r = loadCase(req.params.id);
  if (!r) return bad(res, 'Not found', 404);
  withdrawRelease(r, actorOf(req), str(req.body?.reason, 300));
  res.json({ ok: true });
}));

releasesRouter.post('/releases/:id/remind', allowAny(['releases', 'u'], ['cases', 'u']), h((req, res) => {
  const r = loadCase(req.params.id);
  if (!r) return bad(res, 'Not found', 404);
  if (r.submitted_at || r.withdrawn_at || r.closed_at) return bad(res, 'Nothing to remind about.', 409);
  run(`UPDATE exit_interviews SET reminder_at = datetime('now') WHERE id = ?`, [r.id]);
  recordEvent(r.id, 'release.reminder', actorOf(req), { module: 'releases', auditAction: 'Remind', detail: `Reminder sent to employee (${r.acknowledged_at ? 'exit form' : 'acknowledgement and exit form'})` });
  notify('release.reminder', loadCase(r.id), {});
  res.json({ ok: true });
}));
