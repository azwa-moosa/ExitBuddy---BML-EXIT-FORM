// Release lifecycle shared by: Recruitment screens, the employee experience,
// and inbound OneUI/MiHCM events (mock). One code path = one set of rules.
import crypto from 'node:crypto';
import { all, get, run, getSettings, nextRef } from '../db.js';
import { EXIT_TYPES } from '../config/defaults.js';
import { recordEvent, loadCase } from './workflow.js';
import { notify, alreadyNotified } from './notify.js';
import { outbound } from './integrations.js';
import { defaultVersion, getVersion, validateAnswers } from './questionnaire.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newAccessCode = () => Array.from(crypto.randomBytes(10), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

export class RuleError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

export function validateReleaseDetails(d, employee) {
  const f = { exit_type: str(d.exit_type, 40) || 'Resignation', notice_date: str(d.notice_date, 10), last_day: str(d.last_day, 10), note_to_staff: str(d.note_to_staff) };
  const errs = [];
  if (!EXIT_TYPES.includes(f.exit_type)) errs.push('Choose an exit type from the list');
  if (!isDate(f.last_day)) errs.push('Last working day is required');
  if (f.notice_date && !isDate(f.notice_date)) errs.push('Notice date must be a date');
  if (f.notice_date && f.last_day && f.last_day < f.notice_date) errs.push('Last working day cannot be before the notice date');
  if (employee?.date_joined && f.last_day && f.last_day < employee.date_joined) errs.push('Last working day cannot be before the date of joining');
  if (errs.length) throw new RuleError(errs.join('. '));
  return f;
}

export function openReleaseFor(employeeId) {
  return get(`SELECT id, ref FROM exit_interviews WHERE employee_uid = ? AND withdrawn_at IS NULL AND closed_at IS NULL AND status != 'No response'`, [employeeId]);
}

// Create a release (Recruitment UI or inbound integration).
export function createRelease({ employee, details, actor, source = 'app', externalId = null, at = null }) {
  if (!employee) throw new RuleError('Choose an employee.');
  const s = getSettings();
  const f = validateReleaseDetails(details, employee);
  const open = openReleaseFor(employee.employee_id);
  if (open) throw new RuleError(`${employee.employee_id} already has an open release (${open.ref}).`, 409);
  const year = at ? Number(at.slice(0, 4)) : new Date().getFullYear();
  const ref = nextRef('EX', year);
  const code = newAccessCode();
  const linkExpires = addDays(f.last_day, Number(s.workflow?.linkValidDaysAfterLastDay ?? 14));
  const assignee = s.workflow?.defaultAssigneeUserId && get('SELECT id FROM users WHERE id = ? AND active = 1', [s.workflow.defaultAssigneeUserId]) ? s.workflow.defaultAssigneeUserId : null;
  const { id } = run(`INSERT INTO exit_interviews (ref, access_code, status, employee_uid, employee_ref, name, job_title, grade, division, department, unit, line_manager, date_joined,
      last_day, exit_type, notice_date, note_to_staff, released_by, released_at, questionnaire_version, assigned_to, link_expires_at, source, external_id)
      VALUES (?,?, 'Released', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')), ?,?,?,?,?)`,
    [ref, code, employee.employee_id, employee.id, employee.name, employee.job_title, employee.grade, employee.division, employee.department, employee.unit,
      employee.line_manager, employee.date_joined, f.last_day, f.exit_type, f.notice_date, f.note_to_staff, actor?.name || 'System', at,
      defaultVersion(), assignee, linkExpires, source, externalId]);
  run(`UPDATE employees SET status = 'Released', updated_at = datetime('now') WHERE id = ?`, [employee.id]);
  recordEvent(id, 'release.initiated', actor, {
    at, module: 'releases', auditAction: 'Create',
    detail: `Release initiated (${f.exit_type}, last working day ${f.last_day})${source !== 'app' ? ` from ${source.toUpperCase()}` : ''}; acknowledgement and exit form link issued`,
    data: { source, externalId, lastDay: f.last_day, exitType: f.exit_type },
    ack: { action: 'Release initiated', comment: `Release details confirmed by ${actor?.role || 'System'}`, source },
  });
  const r = loadCase(id);
  notify('release.initiated', r, { actor }, at);
  if (assignee) recordEvent(id, 'case.assigned', { type: 'system', name: 'System', role: 'System' }, { at, detail: 'Assigned to the default ER officer' });
  return r;
}

export function correctRelease(r, changes, actor, reason) {
  if (r.withdrawn_at) throw new RuleError('This release is withdrawn.', 409);
  const f = validateReleaseDetails({ exit_type: r.exit_type, notice_date: r.notice_date, last_day: r.last_day, note_to_staff: r.note_to_staff, ...changes }, { date_joined: r.date_joined });
  const before = { exit_type: r.exit_type, notice_date: r.notice_date, last_day: r.last_day, note_to_staff: r.note_to_staff };
  const diff = Object.keys(f).filter(k => (f[k] || null) !== (before[k] || null));
  if (!diff.length) return { changed: [] };
  const s = getSettings();
  run(`UPDATE exit_interviews SET exit_type=?, notice_date=?, last_day=?, note_to_staff=?, link_expires_at=?, updated_at=datetime('now') WHERE id=?`,
    [f.exit_type, f.notice_date, f.last_day, f.note_to_staff, addDays(f.last_day, Number(s.workflow?.linkValidDaysAfterLastDay ?? 14)), r.id]);
  recordEvent(r.id, 'release.corrected', actor, { module: 'releases', auditAction: 'Edit',
    detail: `Release corrected: ${diff.map(k => `${k.replace('_', ' ')} ${before[k] || '—'} → ${f[k] || '—'}`).join('; ')}${reason ? ` (reason: ${reason})` : ''}`,
    data: { before, after: f, reason }, ack: { action: 'Release corrected', comment: reason || null } });
  return { changed: diff };
}

export function withdrawRelease(r, actor, reason) {
  if (r.withdrawn_at) throw new RuleError('Already withdrawn.', 409);
  if (r.closed_at) throw new RuleError('The exit is already completed.', 409);
  if (!reason) throw new RuleError('Give a reason for withdrawing the release.');
  run(`UPDATE exit_interviews SET withdrawn_at = datetime('now'), withdrawn_reason = ?, updated_at = datetime('now') WHERE id = ?`, [reason, r.id]);
  run(`UPDATE employees SET status = 'Active' WHERE employee_id = ?`, [r.employee_uid]);
  recordEvent(r.id, 'release.withdrawn', actor, { module: 'releases', auditAction: 'Delete', detail: `Release withdrawn: ${reason}`,
    ack: { action: 'Release withdrawn', comment: reason } });
  notify('release.withdrawn', loadCase(r.id), { reason });
}

// ---- employee side ----
export function employeeCanUse(r) {
  if (!r) return 'Not found';
  if (r.withdrawn_at) return 'This release was withdrawn.';
  if (r.link_expires_at && r.link_expires_at < new Date().toISOString().slice(0, 10) && !r.submitted_at) return 'This link has expired. Please contact the Employee Relations team.';
  return null;
}

export function acknowledgeRelease(r, actor, { source = 'app', comment = null, at = null } = {}) {
  if (r.acknowledged_at) return false;
  if (r.withdrawn_at) throw new RuleError('This release was withdrawn.', 409);
  run(`UPDATE exit_interviews SET acknowledged_at = COALESCE(?, datetime('now')), updated_at = datetime('now') WHERE id = ?`, [at, r.id]);
  recordEvent(r.id, 'release.acknowledged', actor, { at, module: 'releases', auditAction: 'Acknowledge',
    detail: source === 'oneui' ? 'Release acknowledged in OneUI (authoritative record)' : 'Release acknowledged electronically',
    ack: { action: 'Release acknowledged', comment, source } });
  const fresh = loadCase(r.id);
  notify('release.acknowledged', fresh, { source }, at);
  if (source === 'app') outbound('release.acknowledgement.status', fresh, { status: 'ACKNOWLEDGED', acknowledgedAt: fresh.acknowledged_at }, at);
  return true;
}

export function saveDraft(r, actor, answers, about) {
  if (r.submitted_at) throw new RuleError('The form is already submitted.', 409);
  if (['Closed', 'No response', 'Withdrawn'].includes(r.status)) throw new RuleError('This form is no longer open.', 409);
  const first = !r.form_started_at;
  run(`UPDATE exit_interviews SET draft = ?, personal_email = ?, mobile = ?, contact_method = ?, form_started_at = COALESCE(form_started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(answers || {}), about.personal_email, about.mobile, about.contact_method, r.id]);
  if (first) recordEvent(r.id, 'form.started', actor, { module: 'cases', auditAction: 'Draft', detail: 'Exit form started (draft saved)' });
}

export function submitForm(r, actor, input, about, { enteredBy = null, at = null } = {}) {
  if (r.submitted_at) throw new RuleError('This form is already submitted.', 409);
  if (['Closed', 'No response', 'Withdrawn'].includes(r.status) && !enteredBy) throw new RuleError('This form is no longer open. Please contact the ER team.', 409);
  const s = getSettings();
  if (!enteredBy && s.workflow?.requireAcknowledgement !== false && s.workflow?.acknowledgementSource !== 'oneui' && !r.acknowledged_at) throw new RuleError('Please acknowledge your release first.', 409);
  const qn = getVersion(r.questionnaire_version);
  const { answers, errors } = validateAnswers(qn.questions, input || {});
  if (errors.length) { const e = new RuleError('Please answer the required questions.'); e.fields = errors; throw e; }
  run(`UPDATE exit_interviews SET answers = ?, draft = '{}', submitted_at = COALESCE(?, datetime('now')), entered_by = ?,
       form_started_at = COALESCE(form_started_at, COALESCE(?, datetime('now'))),
       personal_email = COALESCE(?, personal_email), mobile = COALESCE(?, mobile), contact_method = COALESCE(?, contact_method),
       status = CASE WHEN status = 'No response' THEN 'Released' ELSE status END, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(answers), at, enteredBy, at, about?.personal_email || null, about?.mobile || null, about?.contact_method || null, r.id]);
  recordEvent(r.id, 'form.submitted', actor, { at, module: 'cases', auditAction: enteredBy ? 'Create' : 'Submit',
    detail: enteredBy ? `Paper exit form entered by ${enteredBy}` : 'Exit interview form submitted',
    ack: { action: enteredBy ? 'Paper exit form recorded' : 'Exit interview form submitted', comment: enteredBy ? `Entered on behalf of the employee by ${enteredBy}` : null } });
  const fresh = loadCase(r.id);
  notify('form.submitted', fresh, {}, at);
  outbound('exit.form.status', fresh, { status: 'SUBMITTED', submittedAt: fresh.submitted_at }, at);
  return fresh;
}

export function cleanAbout(a = {}) {
  const s = v => (typeof v === 'string' ? v.trim().slice(0, 200) : '') || null;
  return { personal_email: s(a.personal_email), mobile: s(a.mobile), contact_method: ['Email', 'Phone', 'Either'].includes(a.contact_method) ? a.contact_method : null };
}

export const employeesFor = q => all(`SELECT * FROM employees WHERE status = 'Active' ${q ? 'AND (name LIKE ? OR employee_id LIKE ? OR division LIKE ?)' : ''} ORDER BY name LIMIT 200`, q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []);
export { alreadyNotified };
