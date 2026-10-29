// ============================================================================
// Workflow: status rules, immutable history and digital acknowledgements.
//
//   Released (awaiting acknowledgement) → Acknowledged → Form in progress →
//   Submitted → Meeting scheduled → Interviewed (meeting conducted) → Closed
//   (shown as "Exit completed")
//   Exceptions: No response · Withdrawn · meeting Cancelled / No-show
//
// The ER exit interview meeting is mandatory. An exit can be completed only
// after the employee's form is submitted and a meeting has been conducted
// with its Meeting Remarks recorded. A cancelled or no-show meeting never
// completes the exit. There is no approval step. Internal status names are
// unchanged so existing records and APIs keep working; STATUS_LABEL is what
// the UI shows.
//
// Every significant step writes one row to workflow_events (append-only) and,
// where a person confirms something, a digital acknowledgement record that
// replaces a handwritten signature. Timestamps come from the server (UTC) and
// are shown in Maldives time.
// ============================================================================
import { all, get, run, audit, getSettings, utcNow } from '../db.js';
import { notify, alreadyNotified } from './notify.js';

export const STATUSES = ['Released', 'Acknowledged', 'Form in progress', 'Submitted', 'Meeting scheduled', 'Interviewed', 'Closed', 'No response', 'Withdrawn'];
export const STATUS_LABEL = {
  Released: 'Awaiting acknowledgement', Acknowledged: 'Acknowledged', 'Form in progress': 'Form in progress', Submitted: 'Form submitted',
  'Meeting scheduled': 'ER meeting scheduled', Interviewed: 'ER meeting conducted', Closed: 'Exit completed',
  'No response': 'No response', Withdrawn: 'Release withdrawn',
};
export const OPEN_STATUSES = STATUSES.filter(s => !['Closed', 'Withdrawn', 'No response'].includes(s));

export function parseCase(r) {
  if (!r) return r;
  return { ...r, answers: JSON.parse(r.answers || '{}'), draft: JSON.parse(r.draft || '{}') };
}
export const loadCase = id => parseCase(get('SELECT * FROM exit_interviews WHERE id = ?', [id]));
export const meetingsFor = id => all('SELECT * FROM meetings WHERE exit_id = ? ORDER BY date, time, id', [id]);

// Why an exit cannot be completed yet (null = ready).
export function completionBlocker(r, meetings = null) {
  if (r.withdrawn_at) return 'This release was withdrawn.';
  if (r.closed_at) return 'The exit is already completed.';
  if (!r.submitted_at) return 'The employee has not submitted the exit interview form yet.';
  const ms = meetings || meetingsFor(r.id);
  const held = ms.filter(m => m.status === 'Held');
  if (!held.length) return 'The ER exit interview meeting is mandatory. Schedule it and mark it as conducted first.';
  if (!held.some(m => m.remarks)) return 'Record the Meeting Remarks before completing the exit.';
  return null;
}

export function deriveStatus(r, meetings = null) {
  if (r.withdrawn_at) return 'Withdrawn';
  if (r.closed_at) return 'Closed';
  if (r.submitted_at) {
    const ms = meetings || meetingsFor(r.id);
    if (ms.some(m => m.status === 'Held')) return 'Interviewed';
    if (ms.some(m => m.status === 'Scheduled')) return 'Meeting scheduled';
    return 'Submitted';
  }
  if (r.status === 'No response') return 'No response';
  if (r.form_started_at) return 'Form in progress';
  if (r.acknowledged_at) return 'Acknowledged';
  return 'Released';
}

// Record a workflow step. Call AFTER updating the case columns.
//   actor: from identity.actorOf()  · ack: { action, comment, source } to add a digital record
export function recordEvent(exitId, event, actor, { detail = null, data = null, ack = null, at = null, module = 'cases', auditAction = null, forceStatus = null } = {}) {
  const r = loadCase(exitId);
  const from = r.status;
  const to = forceStatus || deriveStatus(r);
  if (to !== from) run(`UPDATE exit_interviews SET status = ?, updated_at = COALESCE(?, datetime('now')) WHERE id = ?`, [to, at, exitId]);
  const when = at || utcNow();
  const ev = run(`INSERT INTO workflow_events (at, exit_id, ref, event, from_status, to_status, actor_type, actor_id, actor_name, actor_role, detail, data, simulated)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [when, exitId, r.ref, event, from, to, actor?.type || 'system', actor?.actorId || null, actor?.name || 'System', actor?.role || 'System',
      detail, data ? JSON.stringify(data) : null, actor?.simulated ? 1 : 0]);
  if (ack) {
    run(`INSERT INTO acknowledgements (at, exit_id, ref, action, actor_name, actor_id, actor_role, status, comment, source, simulated, event_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [when, exitId, r.ref, ack.action, actor?.name || 'System', actor?.actorId || null, actor?.role || 'System', ack.status || 'Completed electronically',
        ack.comment || null, ack.source || 'app', actor?.simulated ? 1 : 0, ev.id]);
  }
  audit(actor, module, auditAction || event, r.ref, detail || event, when);
  return { eventId: ev.id, from, to };
}

// Housekeeping: automatic "No response" and overdue reminders. Runs on a timer
// and when lists are opened. Each case is notified about being overdue once.
export function sweep() {
  const s = getSettings(); const w = s.workflow || {};
  const sys = { type: 'system', name: 'System', role: 'System' };
  const n = Number(w.noResponseAfterLastDay ?? 7);
  for (const r of all(`SELECT id FROM exit_interviews WHERE withdrawn_at IS NULL AND submitted_at IS NULL AND closed_at IS NULL
                       AND status IN ('Released','Acknowledged','Form in progress') AND date(last_day, '+' || ? || ' days') < date('now')`, [n])) {
    run(`UPDATE exit_interviews SET status = 'No response' WHERE id = ?`, [r.id]);
    recordEvent(r.id, 'no_response', sys, { detail: `No exit form ${n} days after the last working day`, forceStatus: 'No response' });
  }
  const od = Number(w.overdueAfterDays ?? 7);
  for (const r of all(`SELECT e.* FROM exit_interviews e WHERE e.status = 'Submitted' AND e.withdrawn_at IS NULL
                       AND datetime(e.submitted_at, '+' || ? || ' days') < datetime('now')`, [od])) {
    if (!alreadyNotified('case.overdue', r.id)) notify('case.overdue', parseCase(r), { days: od });
  }
}
