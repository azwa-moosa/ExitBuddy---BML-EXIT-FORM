// Employee-facing API. Two ways in, one set of handlers:
//   /api/me/...            the signed-in (in dev: switched-to) employee
//   /api/public/exit/:code the employee-specific link (expires; revoked on withdrawal)
// Employees only ever see their own release, never ER notes or minutes.
import { Router } from 'express';
import { all, get, getSettings } from '../db.js';
import { ABOUT_FIELDS, CONTACT_FIELDS } from '../config/questionnaires.js';
import { actorOf, requireEmployee, devMode } from '../identity.js';
import { parseCase, meetingsFor, STATUS_LABEL } from '../services/workflow.js';
import { getVersion } from '../services/questionnaire.js';
import { acknowledgeRelease, saveDraft, submitForm, cleanAbout, employeeCanUse } from '../services/releases.js';
import { h, bad } from './util.js';

const EMPLOYEE_EVENTS = { 'release.initiated': 'Release initiated', 'release.corrected': 'Release details updated', 'release.acknowledged': 'Release acknowledged',
  'form.started': 'Form started', 'form.submitted': 'Exit form submitted', 'meeting.scheduled': 'ER meeting scheduled', 'meeting.changed': 'ER meeting changed',
  'meeting.cancelled': 'ER meeting cancelled', 'meeting.held': 'ER meeting conducted', 'case.closed': 'Exit completed', 'case.reopened': 'Exit reopened',
  'release.withdrawn': 'Release withdrawn', 'no_response': 'No response recorded' };

function staffView(r) {
  const s = getSettings();
  const qn = getVersion(r.questionnaire_version);
  const meetings = meetingsFor(r.id).filter(m => m.status !== 'Cancelled')
    .map(({ id, date, time, mode, location, interviewer, status }) => ({ id, date, time, mode, location, interviewer, status }));
  return {
    ref: r.ref, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status,
    locked: !!r.submitted_at || ['Closed', 'No response', 'Withdrawn'].includes(r.status),
    acknowledgementSource: s.workflow?.acknowledgementSource || 'app',
    requireAck: s.workflow?.requireAcknowledgement !== false && s.workflow?.acknowledgementSource !== 'oneui',
    acknowledged: !!r.acknowledged_at, acknowledged_at: r.acknowledged_at,
    about: Object.fromEntries(ABOUT_FIELDS.map(f => [f.key, r[f.key] ?? ''])),
    contact: Object.fromEntries(CONTACT_FIELDS.map(f => [f.key, r[f.key] ?? ''])),
    release: { exit_type: r.exit_type, notice_date: r.notice_date, last_day: r.last_day, note_to_staff: r.note_to_staff, released_at: r.released_at, released_by: r.released_by, link_expires_at: r.link_expires_at },
    questionnaire: { questions: qn.questions.filter(q => q.active !== false) },
    answers: r.submitted_at ? r.answers : r.draft, submitted_at: r.submitted_at, form_started_at: r.form_started_at,
    meetings,
    completed_at: r.closed_at,
    records: all(`SELECT at, action, actor_name, actor_id, actor_role, status, source, simulated FROM acknowledgements WHERE exit_id = ? AND actor_role = 'Employee' ORDER BY id`, [r.id]),
    messages: all(`SELECT at, title, body, channel, status FROM notifications WHERE exit_id = ? AND audience = 'employee' ORDER BY id DESC`, [r.id]),
    timeline: all('SELECT at, event FROM workflow_events WHERE exit_id = ? ORDER BY id', [r.id]).filter(e => EMPLOYEE_EVENTS[e.event]).map(e => ({ at: e.at, label: EMPLOYEE_EVENTS[e.event] })),
  };
}

function handlers(resolve) {
  const router = Router({ mergeParams: true });
  const load = (req, res) => {
    const r = resolve(req);
    if (!r) { res.status(404).json({ error: 'No release found.' }); return null; }
    const why = employeeCanUse(r);
    if (why && req.method !== 'GET') { res.status(409).json({ error: why }); return null; }
    if (why && r.withdrawn_at) { res.status(410).json({ error: why }); return null; }
    return r;
  };
  const actor = req => req.identity?.kind === 'employee' ? actorOf(req)
    : { type: 'employee', name: req._case.name, role: 'Employee', actorId: req._case.employee_uid, simulated: devMode() };

  router.get('/', h((req, res) => { const r = load(req, res); if (r) res.json({ release: staffView(r), expired: employeeCanUse(r) }); }));
  router.post('/acknowledge', h((req, res) => {
    const r = load(req, res); if (!r) return; req._case = r;
    if (getSettings().workflow?.acknowledgementSource === 'oneui') return bad(res, 'Your release is acknowledged in OneUI.', 409);
    acknowledgeRelease(r, actor(req), { comment: req.body?.comment ? String(req.body.comment).slice(0, 500) : null });
    res.json({ ok: true });
  }));
  router.put('/draft', h((req, res) => {
    const r = load(req, res); if (!r) return; req._case = r;
    saveDraft(r, actor(req), req.body?.answers || {}, cleanAbout(req.body?.about));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  }));
  router.post('/submit', h((req, res) => {
    const r = load(req, res); if (!r) return; req._case = r;
    const done = submitForm(r, actor(req), req.body?.answers || {}, cleanAbout(req.body?.about));
    res.json({ ok: true, ref: done.ref, submitted_at: done.submitted_at });
  }));
  return router;
}

// Signed-in employee (dev: switched identity).
export const meRouter = Router();
meRouter.use(requireEmployee);
meRouter.use('/release', handlers(req => parseCase(get(`SELECT * FROM exit_interviews WHERE employee_uid = ? ORDER BY CASE WHEN withdrawn_at IS NULL THEN 0 ELSE 1 END, released_at DESC LIMIT 1`, [req.identity.employee.employeeId]))));

// Employee-specific link.
const misses = new Map();
export const linkRouter = Router();
linkRouter.use('/:code', (req, res, next) => {
  const m = misses.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - m.t > 10 * 60e3) { m.n = 0; m.t = Date.now(); }
  if (m.n >= 25) return bad(res, 'Too many attempts. Try again in 10 minutes.', 429);
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const r = get('SELECT id FROM exit_interviews WHERE access_code = ?', [code]);
  if (!r) { m.n++; misses.set(req.ip, m); return bad(res, 'We could not find that link. Check the link in your release message.', 404); }
  req._caseId = r.id; next();
}, handlers(req => parseCase(get('SELECT * FROM exit_interviews WHERE id = ?', [req._caseId]))));
