// ============================================================================
// Notifications — MOCK provider.
// Nothing is sent to Microsoft Teams or email. Each notification is stored
// with status "Simulated" (or "Failed" when failure simulation is on), so the
// Notification Centre shows exactly who WOULD be told, about what, and when.
// To go live, replace deliverMock() with a Microsoft Graph / Teams provider
// (see INTEGRATION_GUIDE.md → Microsoft Teams). Routing rules are stored in
// settings.notificationRules and reference ROLES, not people. Meeting
// participants who are configured users are notified too; participants entered
// by name only (external) are listed on the meeting but not messaged.
// ============================================================================
import { all, get, run, getSettings, utcNow } from '../db.js';

const fmtDay = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${+dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`; };

function message(event, r, ctx) {
  const ref = r?.ref || ctx.ref || '';
  const div = r?.division || ctx.division || '';
  const M = {
    'release.initiated': {
      employee: [`Action required: your release acknowledgement and exit interview`, `Your release has been processed (last working day ${fmtDay(r?.last_day)}). Please acknowledge your release and complete your exit interview form. Completing the form is required as part of your release process.`],
      full: [`New staff release ${ref}`, `${r?.name} (${r?.job_title}, ${div}) was released by ${ctx.actor?.name || 'Recruitment'}. Last working day ${fmtDay(r?.last_day)}.`],
      summary: [`New staff release in ${div}`, `A staff release (${ref}) was initiated in ${div}.`],
    },
    'release.acknowledged': { full: [`Release acknowledged ${ref}`, `${r?.name} acknowledged their release${ctx.source === 'oneui' ? ' in OneUI' : ''}.`], summary: [`Release acknowledged ${ref}`, `The release ${ref} was acknowledged.`] },
    'form.submitted': { full: [`Exit form submitted ${ref}`, `${r?.name} (${div}) submitted their exit interview form. Review it and arrange the exit meeting.`], summary: [`Exit form submitted in ${div}`, `An exit interview form (${ref}) was submitted in ${div}.`] },
    'meeting.scheduled': {
      employee: [`Your exit interview meeting`, `Your meeting with the Employee Relations team is on ${fmtDay(ctx.meeting?.date)} at ${ctx.meeting?.time} (${ctx.meeting?.mode}${ctx.meeting?.location ? `, ${ctx.meeting.location}` : ''}). Attending this meeting is part of your exit process.`],
      full: [`ER meeting scheduled ${ref}`, `${fmtDay(ctx.meeting?.date)} ${ctx.meeting?.time} with ${r?.name} (${ctx.meeting?.mode}). ER officer: ${ctx.meeting?.interviewer}.`],
    },
    'meeting.changed': {
      employee: [`Your exit interview meeting has changed`, ctx.meeting?.status === 'Cancelled' ? 'Your exit interview meeting was cancelled. The ER team will contact you to arrange a new time.' : `Your meeting is now on ${fmtDay(ctx.meeting?.date)} at ${ctx.meeting?.time} (${ctx.meeting?.mode}).`],
      full: [`ER meeting ${ctx.meeting?.status === 'Cancelled' ? 'cancelled' : 'changed'} ${ref}`, `${r?.name}: ${ctx.meeting?.status === 'Cancelled' ? 'meeting cancelled — a new meeting must be scheduled' : `${fmtDay(ctx.meeting?.date)} ${ctx.meeting?.time}`}.`],
    },
    'case.assigned': { full: [`Case assigned to you ${ref}`, `${r?.name} (${div}) is assigned to you by ${ctx.actor?.name || 'System'}.`] },
    'case.closed': {
      employee: [`Your exit is complete`, `Thank you. Your exit interview and ER meeting are complete (reference ${ref}).`],
      full: [`Exit completed ${ref}`, `The exit for ${r?.name} was completed by ${ctx.actor?.name || 'the ER team'}.`], summary: [`Exit completed in ${div}`, `Exit ${ref} in ${div} is completed.`],
    },
    'case.overdue': { full: [`ER meeting overdue ${ref}`, `${r?.name}'s form was submitted more than ${ctx.days} days ago and the mandatory ER meeting is not booked.`] },
    'release.reminder': { employee: [`Reminder: your release acknowledgement and exit interview`, `Please ${r?.acknowledged_at ? '' : 'acknowledge your release and '}complete your exit interview form before your last working day (${fmtDay(r?.last_day)}). It is required as part of your release process.`] },
    'release.withdrawn': { employee: [`Your release was withdrawn`, `Your release (${ref}) was withdrawn. You do not need to complete the exit form.`], full: [`Release withdrawn ${ref}`, `${r?.name}'s release was withdrawn: ${ctx.reason || ''}`] },
    'integration.failed': { full: [`Integration error: ${ctx.system}`, `${ctx.eventType} for ${ref || 'n/a'} failed: ${ctx.error}`] },
    'notification.failed': { full: [`Notification delivery failed`, `"${ctx.title}" to ${ctx.recipient} failed after ${ctx.attempts} attempts.`] },
  }[event] || { full: [event, ref] };
  return M;
}

// Mock provider: tries up to `maxAttempts` times (automatic retries), then
// marks the notification Failed and alerts System Admins. Nothing is sent.
function deliverMock(id, at = null) {
  const s = getSettings();
  const n = get('SELECT * FROM notifications WHERE id = ?', [id]);
  const rate = Number(s.notifications?.mockFailureRate || 0);
  const max = Math.max(1, Number(s.notifications?.maxAttempts || 3));
  let tries = 0;
  while (tries < max) {
    tries++;
    const fail = n.event !== 'notification.failed' && Math.random() < rate;
    if (!fail) {
      run(`UPDATE notifications SET status = 'Simulated', attempts = attempts + ?, last_error = NULL, delivered_at = ? WHERE id = ?`, [tries, at || utcNow(), id]);
      return true;
    }
  }
  run(`UPDATE notifications SET status = 'Failed', attempts = attempts + ?, last_error = ? WHERE id = ?`, [tries, `Simulated delivery failure after ${tries} attempt${tries > 1 ? 's' : ''} (mock provider)`, id]);
  notify('notification.failed', null, { ref: n.ref, title: n.title, recipient: n.recipient_name, attempts: n.attempts + tries });
  return false;
}

export function retryNotification(id) {
  const n = get('SELECT * FROM notifications WHERE id = ?', [id]);
  if (!n || n.status !== 'Failed') return false;
  deliverMock(id);
  return true;
}

export const alreadyNotified = (event, exitId) => !!get('SELECT 1 FROM notifications WHERE event = ? AND exit_id = ? LIMIT 1', [event, exitId]);

// Create (and mock-deliver) the notifications for an event.
export function notify(event, r, ctx = {}, at = null) {
  const s = getSettings();
  const rule = (s.notificationRules || []).find(x => x.event === event);
  if (!rule || rule.enabled === false) return [];
  const msg = message(event, r, ctx);
  const targets = new Map(); // key → { audience, user, detail }
  const addUser = (u, detail) => {
    if (!u) return;
    const k = `u${u.id}`; const prev = targets.get(k);
    if (!prev || (prev.detail === 'summary' && detail === 'full')) targets.set(k, { audience: 'user', user: u, detail });
  };
  const userById = id => id && get(`SELECT u.id, u.name, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.active = 1`, [id]);
  for (const rc of rule.recipients || []) {
    const detail = rc.detail || 'full';
    if (ctx.onlyParticipants && rc.type !== 'participants') continue;   // participants added to an existing meeting
    if (rc.type === 'employee' && r) targets.set('employee', { audience: 'employee', detail: 'employee' });
    if (rc.type === 'assignee' && r?.assigned_to) addUser(userById(r.assigned_to), detail);
    if (rc.type === 'interviewer' && ctx.meeting?.interviewer_id) addUser(userById(ctx.meeting.interviewer_id), detail);
    if (rc.type === 'participants') (ctx.participants || []).forEach(p => p.user_id && addUser(userById(p.user_id), detail));
    if (rc.type === 'role' && rc.roleId) all(`SELECT u.id, u.name, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.role_id = ? AND u.active = 1`, [rc.roleId]).forEach(u => addUser(u, detail));
  }
  const created = [];
  for (const t of targets.values()) {
    const [title, body] = (t.detail === 'employee' ? msg.employee : t.detail === 'summary' ? (msg.summary || msg.full) : msg.full) || msg.full;
    if (!title) continue;
    const isEmp = t.audience === 'employee';
    const { id } = run(`INSERT INTO notifications (at, event, exit_id, ref, channel, audience, user_id, employee_id, recipient_name, recipient_role, title, body, link, detail_level)
                        VALUES (COALESCE(?, datetime('now')),?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [at, event, r?.id || null, r?.ref || ctx.ref || null, isEmp ? 'Email + Teams (mock)' : 'Microsoft Teams (mock)', t.audience,
        isEmp ? null : t.user.id, isEmp ? r.employee_uid : null, isEmp ? r.name : t.user.name, isEmp ? 'Employee' : t.user.role,
        title, body, isEmp && r?.access_code ? `/exit/${r.access_code}` : (r?.id ? `/hr/cases/${r.id}` : null), isEmp ? 'full' : t.detail]);
    deliverMock(id, at);
    created.push(id);
  }
  return created;
}
