// Administration: users, roles & permissions, settings, the (read-only)
// ExitBuddy questionnaire, notifications, integrations (mock), audit trail,
// system overview.
import { Router } from 'express';
import fs from 'node:fs';
import { all, get, run, getSettings, setSetting, audit, dbFile } from '../db.js';
import { allow, allowAny, actorOf, can, devMode, authMode } from '../identity.js';
import { MODULES, EXIT_TYPES } from '../config/defaults.js';
import { defaultVersion, getVersion } from '../services/questionnaire.js';
import { retryNotification } from '../services/notify.js';
import { retryIntegration, recordInbound, setInboundRef } from '../services/integrations.js';
import { createRelease, acknowledgeRelease } from '../services/releases.js';
import { loadCase, STATUS_LABEL } from '../services/workflow.js';
import { h, bad, str, isDate } from './util.js';

export const adminRouter = Router();
const A = req => actorOf(req);

// ---------------------------------------------------------------- system overview
adminRouter.get('/admin/overview', allowAny(['config', 'r'], ['users', 'r']), h((req, res) => {
  const c = sql => get(sql).n;
  res.json({
    mode: { devMode: devMode(), authMode: authMode(), nodeEnv: process.env.NODE_ENV || 'development' },
    counts: {
      users: c('SELECT COUNT(*) AS n FROM users WHERE active = 1'), roles: c('SELECT COUNT(*) AS n FROM roles'), employees: c('SELECT COUNT(*) AS n FROM employees'),
      releases: c('SELECT COUNT(*) AS n FROM exit_interviews'), openCases: c(`SELECT COUNT(*) AS n FROM exit_interviews WHERE status NOT IN ('Closed','Withdrawn','No response')`),
      notifications: c('SELECT COUNT(*) AS n FROM notifications'), failedNotifications: c(`SELECT COUNT(*) AS n FROM notifications WHERE status = 'Failed'`),
      integrationEvents: c('SELECT COUNT(*) AS n FROM integration_events'), failedIntegrations: c(`SELECT COUNT(*) AS n FROM integration_events WHERE status IN ('Failed','Rejected')`),
      auditEvents: c('SELECT COUNT(*) AS n FROM audit_log'), workflowEvents: c('SELECT COUNT(*) AS n FROM workflow_events'), digitalRecords: c('SELECT COUNT(*) AS n FROM acknowledgements'),
    },
    questionnaire: get(`SELECT version, name FROM questionnaires WHERE version = ?`, [defaultVersion()]),
    migrations: all('SELECT id, applied_at FROM schema_migrations ORDER BY id'),
    database: { file: dbFile().split('/').slice(-3).join('/'), sizeKb: fs.existsSync(dbFile()) ? Math.round(fs.statSync(dbFile()).size / 1024) : 0 },
    recentFailures: all(`SELECT at, 'Notification' AS kind, title AS what, last_error AS error FROM notifications WHERE status = 'Failed'
                         UNION ALL SELECT at, 'Integration', system || ' ' || event_type, last_error FROM integration_events WHERE status IN ('Failed','Rejected')
                         ORDER BY at DESC LIMIT 8`),
  });
}));

// ---------------------------------------------------------------- users & roles
adminRouter.get('/modules', allow('users', 'r'), (req, res) => res.json({ modules: MODULES }));
adminRouter.get('/users', allow('users', 'r'), h((req, res) => {
  res.json({ users: all(`SELECT u.id, u.name, u.email, u.title, u.persona, u.active, u.last_login, u.created_at, u.role_id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.persona, r.sort, u.name`) });
}));
const adminsLeft = (exceptId = 0) => get(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.system = 1 AND u.active = 1 AND u.id != ?`, [exceptId]).n;
adminRouter.post('/users', allow('users', 'c'), h((req, res) => {
  const name = str(req.body?.name, 120), email = str(req.body?.email, 200)?.toLowerCase(), roleId = Number(req.body?.role_id);
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Name and a valid email are required.');
  const role = get('SELECT id, name FROM roles WHERE id = ?', [roleId]); if (!role) return bad(res, 'Choose a role.');
  if (get('SELECT 1 FROM users WHERE email = ?', [email])) return bad(res, 'A user with that email already exists.', 409);
  run('INSERT INTO users (name, email, title, role_id, active) VALUES (?,?,?,?,1)', [name, email, str(req.body?.title, 120), roleId]);
  audit(A(req), 'users', 'Create', email, `User ${name} added as ${role.name}`);
  res.status(201).json({ ok: true });
}));
adminRouter.put('/users/:id', allow('users', 'u'), h((req, res) => {
  const u = get('SELECT u.*, r.name AS role, r.system FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [req.params.id]);
  if (!u) return bad(res, 'Not found', 404);
  const name = str(req.body?.name, 120) || u.name; const title = req.body?.title !== undefined ? str(req.body.title, 120) : u.title;
  const roleId = Number(req.body?.role_id || u.role_id); const active = req.body?.active === undefined ? u.active : (req.body.active ? 1 : 0);
  const role = get('SELECT id, name, system FROM roles WHERE id = ?', [roleId]); if (!role) return bad(res, 'Choose a role.');
  if (u.system && u.active && (!role.system || !active) && adminsLeft(u.id) === 0) return bad(res, 'Keep at least one active System Admin.', 409);
  const changes = [name !== u.name && `name → ${name}`, title !== u.title && `title → ${title || '—'}`, roleId !== u.role_id && `role ${u.role} → ${role.name}`, active !== u.active && (active ? 'activated' : 'deactivated')].filter(Boolean);
  run('UPDATE users SET name = ?, title = ?, role_id = ?, active = ? WHERE id = ?', [name, title, roleId, active, u.id]);
  audit(A(req), 'users', 'Edit', u.email, changes.join('; ') || 'No changes');
  res.json({ ok: true });
}));
adminRouter.delete('/users/:id', allow('users', 'd'), h((req, res) => {
  const u = get('SELECT u.*, r.system FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [req.params.id]);
  if (!u) return bad(res, 'Not found', 404);
  if (u.id === req.user.id) return bad(res, 'You cannot delete the user you are acting as.', 409);
  if (u.system && u.active && adminsLeft(u.id) === 0) return bad(res, 'Keep at least one active System Admin.', 409);
  if (get('SELECT 1 FROM exit_interviews WHERE assigned_to = ? LIMIT 1', [u.id]) || get('SELECT 1 FROM notifications WHERE user_id = ? LIMIT 1', [u.id]))
    return bad(res, 'This user is linked to cases or notifications. Deactivate the account instead, so the history stays complete.', 409);
  run('DELETE FROM users WHERE id = ?', [u.id]);
  audit(A(req), 'users', 'Delete', u.email, `User ${u.name} removed`);
  res.json({ ok: true });
}));

function cleanPerms(input) {
  const out = {};
  MODULES.forEach(m => { const g = (input || {})[m.key] || {}; const ops = Object.fromEntries(m.ops.filter(o => g[o]).map(o => [o, true])); if (Object.keys(ops).length) out[m.key] = ops; });
  Object.entries(out).forEach(([k, o]) => { const mod = MODULES.find(m => m.key === k); if ((o.c || o.u || o.d) && mod.ops.includes('r')) o.r = true; });
  return out;
}
const DASHBOARDS = ['admin', 'er', 'executive', 'recruitment', 'audit'];
adminRouter.get('/roles', allow('users', 'r'), h((req, res) => {
  const roles = all('SELECT * FROM roles ORDER BY sort, id').map(r => ({ ...r, permissions: JSON.parse(r.permissions), members: all('SELECT id, name, title, persona, active FROM users WHERE role_id = ? ORDER BY name', [r.id]) }));
  res.json({ roles, modules: MODULES, dashboards: DASHBOARDS });
}));
adminRouter.post('/roles', allow('users', 'c'), h((req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) return bad(res, 'Give the role a name.');
  if (get('SELECT 1 FROM roles WHERE name = ?', [name])) return bad(res, 'A role with that name exists.', 409);
  const { id } = run('INSERT INTO roles (name, description, permissions, dashboard, sort) VALUES (?,?,?,?,?)',
    [name, str(req.body?.description, 300), JSON.stringify(cleanPerms(req.body?.permissions)), DASHBOARDS.includes(req.body?.dashboard) ? req.body.dashboard : 'er', 60]);
  audit(A(req), 'users', 'Create', name, 'Role created');
  res.status(201).json({ ok: true, id });
}));
adminRouter.put('/roles/:id', allow('users', 'u'), h((req, res) => {
  const r = get('SELECT * FROM roles WHERE id = ?', [req.params.id]);
  if (!r) return bad(res, 'Not found', 404);
  if (r.system && req.body?.permissions) return bad(res, 'System Admin always has full access.', 409);
  const name = str(req.body?.name, 60) || r.name;
  if (name !== r.name && get('SELECT 1 FROM roles WHERE name = ? AND id != ?', [name, r.id])) return bad(res, 'A role with that name exists.', 409);
  const perms = req.body?.permissions ? cleanPerms(req.body.permissions) : JSON.parse(r.permissions);
  const before = JSON.parse(r.permissions);
  const label = { c: 'Create', r: 'View', u: 'Edit', d: 'Delete' };
  const diff = MODULES.flatMap(m => m.ops.filter(o => !!before[m.key]?.[o] !== !!perms[m.key]?.[o]).map(o => `${m.label} ${label[o]} ${perms[m.key]?.[o] ? 'on' : 'off'}`));
  const dash = DASHBOARDS.includes(req.body?.dashboard) ? req.body.dashboard : r.dashboard;
  run('UPDATE roles SET name = ?, description = ?, permissions = ?, dashboard = ? WHERE id = ?', [name, req.body?.description !== undefined ? str(req.body.description, 300) : r.description, JSON.stringify(perms), dash, r.id]);
  audit(A(req), 'users', 'Edit', name, diff.length ? `Permissions: ${diff.join('; ')}` : 'Role details updated');
  res.json({ ok: true });
}));
adminRouter.delete('/roles/:id', allow('users', 'd'), h((req, res) => {
  const r = get('SELECT * FROM roles WHERE id = ?', [req.params.id]);
  if (!r) return bad(res, 'Not found', 404);
  if (r.system) return bad(res, 'This role cannot be deleted.', 409);
  const n = get('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', [r.id]).n;
  if (n) return bad(res, `Move the ${n} user${n > 1 ? 's' : ''} in this role first.`, 409);
  run('DELETE FROM roles WHERE id = ?', [r.id]);
  audit(A(req), 'users', 'Delete', r.name, 'Role deleted');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- settings
adminRouter.get('/settings', allow('config', 'r'), h((req, res) => res.json({ settings: getSettings(), exitTypes: EXIT_TYPES })));
adminRouter.put('/settings', allow('config', 'u'), h((req, res) => {
  const cur = getSettings(); const b = req.body || {}; const next = { ...cur };
  const n = (v, lo, hi) => { const x = Number(v); return v !== '' && v != null && Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
  for (const [k, max] of [['appName', 80], ['companyName', 60], ['orgName', 100]]) if (k in b) next[k] = str(b[k], max) || cur[k];
  if ('brandTheme' in b) next.brandTheme = ['teal', 'exitbuddy'].includes(b.brandTheme) ? b.brandTheme : cur.brandTheme;
  if ('timezone' in b) { try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); next.timezone = b.timezone; } catch { return bad(res, 'Unknown time zone'); } }
  for (const [k, lo, hi] of [['minResponses', 1, 50], ['suppressBelow', 1, 50]])
    if (k in b) { const v = n(b[k], lo, hi); if (v == null) return bad(res, `${k} is out of range`); next[k] = Math.round(v); }
  if (Array.isArray(b.divisions)) { const list = [...new Set(b.divisions.map(d => str(d, 80)).filter(Boolean))]; if (!list.length) return bad(res, 'Keep at least one division.'); next.divisions = list; }
  if (b.workflow && typeof b.workflow === 'object') {
    const w = { ...cur.workflow };
    // The ER meeting is always mandatory and there is no approval step — not configurable.
    if ('requireAcknowledgement' in b.workflow) w.requireAcknowledgement = !!b.workflow.requireAcknowledgement;
    if ('acknowledgementSource' in b.workflow) w.acknowledgementSource = b.workflow.acknowledgementSource === 'oneui' ? 'oneui' : 'app';
    for (const k of ['reminderAfterDays', 'noResponseAfterLastDay', 'linkValidDaysAfterLastDay', 'overdueAfterDays']) if (k in b.workflow) { const v = n(b.workflow[k], 0, 365); if (v == null) return bad(res, `${k} is out of range`); w[k] = Math.round(v); }
    if ('defaultAssigneeUserId' in b.workflow) w.defaultAssigneeUserId = b.workflow.defaultAssigneeUserId ? Number(b.workflow.defaultAssigneeUserId) : null;
    next.workflow = w;
  }
  const changed = Object.keys(next).filter(k => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
  changed.forEach(k => setSetting(k, next[k]));
  audit(A(req), 'config', 'Edit', null, changed.length ? `Settings changed: ${changed.join(', ')}` : 'No changes');
  res.json({ settings: next });
}));

// ---------------------------------------------------------------- questionnaire (read-only)
adminRouter.get('/questionnaire', allow('questionnaire', 'r'), h((req, res) => {
  const q = getVersion(defaultVersion()); if (!q) return bad(res, 'Not found', 404);
  res.json({ questionnaire: { version: q.version, name: q.name, note: q.note, questions: q.questions.filter(x => x.active !== false) },
    responses: get('SELECT COUNT(*) AS n FROM exit_interviews WHERE questionnaire_version = ? AND submitted_at IS NOT NULL', [q.version]).n });
}));

// ---------------------------------------------------------------- notifications
adminRouter.get('/notifications', h((req, res) => {
  const scopeAll = req.query.scope === 'all' && can(req.user, 'notifications', 'r');
  const where = scopeAll ? '' : 'WHERE n.user_id = ?';
  const params = scopeAll ? [] : [req.user.id];
  const list = all(`SELECT n.* FROM notifications n ${where} ORDER BY n.id DESC LIMIT 500`, params);
  const unread = get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`, [req.user.id]).n;
  res.json({ notifications: list, unread, scope: scopeAll ? 'all' : 'mine', rules: can(req.user, 'notifications', 'r') ? (getSettings().notificationRules || []) : undefined });
}));
adminRouter.post('/notifications/read-all', h((req, res) => { run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`, [req.user.id]); res.json({ ok: true }); }));
adminRouter.post('/notifications/:id/read', h((req, res) => { run(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]); res.json({ ok: true }); }));
adminRouter.post('/notifications/:id/retry', allow('notifications', 'u'), h((req, res) => {
  if (!retryNotification(Number(req.params.id))) return bad(res, 'Only failed notifications can be retried.', 409);
  audit(A(req), 'notifications', 'Edit', null, `Notification ${req.params.id} retried`);
  res.json({ ok: true, notification: get('SELECT * FROM notifications WHERE id = ?', [req.params.id]) });
}));
adminRouter.put('/notification-settings', allow('notifications', 'u'), h((req, res) => {
  const s = getSettings(); const b = req.body || {};
  const rate = Number(b.mockFailureRate); const max = Number(b.maxAttempts);
  if (!(rate >= 0 && rate <= 1) || !(max >= 1 && max <= 10)) return bad(res, 'Failure rate 0–1 and attempts 1–10.');
  setSetting('notifications', { ...s.notifications, mockFailureRate: rate, maxAttempts: Math.round(max) });
  if (Array.isArray(b.rules)) {
    const roles = all('SELECT id FROM roles').map(r => r.id);
    const rules = b.rules.map(r => ({ event: r.event, label: r.label, enabled: r.enabled !== false,
      recipients: (r.recipients || []).filter(x => ['employee', 'assignee', 'interviewer', 'participants'].includes(x.type) || (x.type === 'role' && roles.includes(Number(x.roleId))))
        .map(x => ({ type: x.type, ...(x.type === 'role' ? { roleId: Number(x.roleId) } : {}), detail: x.detail === 'summary' ? 'summary' : 'full' })) }));
    setSetting('notificationRules', rules);
  }
  audit(A(req), 'notifications', 'Edit', null, 'Notification settings changed');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- integrations (mock)
adminRouter.get('/integrations', allow('integrations', 'r'), h((req, res) => {
  const s = getSettings();
  res.json({ settings: s.integrations, workflow: { acknowledgementSource: s.workflow?.acknowledgementSource },
    sharedSecretSet: !!process.env.INTEGRATION_SHARED_SECRET,
    events: all('SELECT * FROM integration_events ORDER BY id DESC LIMIT 300') });
}));
adminRouter.put('/integrations', allow('integrations', 'u'), h((req, res) => {
  const s = getSettings(); const b = req.body || {}; const cur = s.integrations || {};
  const mode = v => ['mock', 'disabled'].includes(v) ? v : 'mock';     // "live" is not available until the integrations are built and approved
  const next = {
    ...cur,
    mihcm: { ...cur.mihcm, mode: mode(b.mihcm?.mode ?? cur.mihcm?.mode) },
    oneui: { ...cur.oneui, mode: mode(b.oneui?.mode ?? cur.oneui?.mode), syncAcknowledgement: b.oneui?.syncAcknowledgement ?? cur.oneui?.syncAcknowledgement },
    teams: { ...cur.teams, mode: mode(b.teams?.mode ?? cur.teams?.mode) },
    simulateFailure: b.simulateFailure ?? cur.simulateFailure,
  };
  setSetting('integrations', next);
  if (b.acknowledgementSource) setSetting('workflow', { ...s.workflow, acknowledgementSource: b.acknowledgementSource === 'oneui' ? 'oneui' : 'app' });
  audit(A(req), 'integrations', 'Edit', null, 'Integration settings changed');
  res.json({ ok: true });
}));
adminRouter.post('/integrations/events/:id/retry', allow('integrations', 'u'), h((req, res) => {
  const ok = retryIntegration(Number(req.params.id));
  audit(A(req), 'integrations', 'Edit', null, `Integration event ${req.params.id} retried (${ok ? 'delivered (mock)' : 'still failing'})`);
  res.json({ ok, event: get('SELECT * FROM integration_events WHERE id = ?', [req.params.id]) });
}));

// Inbound processing shared by the simulator and the external endpoint.
export function processInbound(system, body, actorName) {
  const actor = { type: 'integration', name: `${system} integration`, role: 'Integration', actorId: system, simulated: true };
  const eventId = str(body?.eventId, 100); const type = str(body?.eventType, 80);
  if (type === 'staff.release.initiated') {
    const e = get('SELECT * FROM employees WHERE employee_id = ?', [str(body.employeeId, 40)]);
    if (!e) { const r = recordInbound(system, type, eventId, body, 'Rejected', `Unknown employee ${body.employeeId}`); return { status: 422, error: `Unknown employee ${body.employeeId}`, ...r }; }
    const ev = recordInbound(system, type, eventId, body, 'Received');
    if (ev.duplicate) return { status: 200, duplicate: true, ref: ev.ref };
    try {
      const r = createRelease({ employee: e, details: { exit_type: body.exitType, notice_date: body.noticeDate, last_day: body.lastWorkingDay, note_to_staff: body.note },
        actor: { ...actor, name: `${system}: ${str(body.initiatedBy, 80) || actorName || 'release event'}` }, source: system.toLowerCase(), externalId: str(body.releaseId, 80) });
      setInboundRef(ev.id, r.ref, 'Processed');
      return { status: 201, ref: r.ref, link: `/exit/${r.access_code}` };
    } catch (err) { setInboundRef(ev.id, null, 'Rejected'); run('UPDATE integration_events SET last_error = ? WHERE id = ?', [err.message, ev.id]); return { status: err.status || 422, error: err.message }; }
  }
  if (type === 'staff.release.acknowledged') {
    const r = loadCase(get('SELECT id FROM exit_interviews WHERE ref = ? OR (external_id IS NOT NULL AND external_id = ?)', [str(body.reference, 40), str(body.releaseId, 80)])?.id);
    if (!r) { recordInbound(system, type, eventId, body, 'Rejected', 'Unknown release'); return { status: 404, error: 'Unknown release' }; }
    const ev = recordInbound(system, type, eventId, body, 'Received', null, r.ref);
    if (ev.duplicate) return { status: 200, duplicate: true, ref: r.ref };
    const done = acknowledgeRelease(r, { ...actor, name: r.name, role: 'Employee', actorId: r.employee_uid }, { source: 'oneui', comment: `Acknowledged in ${system}` });
    setInboundRef(ev.id, r.ref, done ? 'Processed' : 'Ignored (already acknowledged)');
    return { status: 200, ref: r.ref, acknowledged: done };
  }
  recordInbound(system, type || 'unknown', eventId, body, 'Rejected', 'Unsupported event type');
  return { status: 400, error: 'Unsupported event type' };
}
adminRouter.post('/integrations/simulate', allow('integrations', 'u'), h((req, res) => {
  const system = req.body?.system === 'OneUI' ? 'OneUI' : 'MiHCM';
  const body = { ...req.body?.payload, eventId: req.body?.payload?.eventId || `SIM-${Date.now()}` };
  const out = processInbound(system, body, req.user.name);
  audit(A(req), 'integrations', 'Create', out.ref || null, `Simulated ${system} event ${body.eventType}: ${out.error || (out.duplicate ? 'duplicate ignored' : 'processed')}`);
  res.status(out.status >= 400 ? out.status : 200).json(out);
}));

// ---------------------------------------------------------------- audit
function auditQuery(q) {
  const where = []; const p = [];
  if (q.q) { where.push('(user_name LIKE ? OR ref LIKE ? OR detail LIKE ? OR action LIKE ?)'); const l = `%${q.q}%`; p.push(l, l, l, l); }
  if (q.user) { where.push('user_name = ?'); p.push(q.user); }
  if (q.module) { where.push('module = ?'); p.push(q.module); }
  if (q.action) { where.push('action = ?'); p.push(q.action); }
  if (isDate(q.from)) { where.push('date(at) >= ?'); p.push(q.from); }
  if (isDate(q.to)) { where.push('date(at) <= ?'); p.push(q.to); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', p };
}
adminRouter.get('/audit', allow('audit', 'r'), h((req, res) => {
  const { sql, p } = auditQuery(req.query);
  const page = Math.max(1, Number(req.query.page) || 1); const size = Math.min(200, Math.max(10, Number(req.query.size) || 50));
  res.json({
    entries: all(`SELECT * FROM audit_log ${sql} ORDER BY id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p),
    total: get(`SELECT COUNT(*) AS n FROM audit_log ${sql}`, p).n, page, size,
    users: all('SELECT DISTINCT user_name FROM audit_log ORDER BY user_name').map(r => r.user_name),
    actions: all('SELECT DISTINCT action FROM audit_log ORDER BY action').map(r => r.action),
    modules: all('SELECT DISTINCT module FROM audit_log WHERE module IS NOT NULL ORDER BY module').map(r => r.module),
  });
}));
adminRouter.get('/audit.csv', allow('audit', 'r'), h((req, res) => {
  const { sql, p } = auditQuery(req.query);
  const rows = all(`SELECT at, user_name, user_email, role, actor_id, simulated, module, action, ref, detail FROM audit_log ${sql} ORDER BY id DESC`, p);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  audit(A(req), 'audit', 'Export', null, `Audit trail exported (${rows.length} rows)`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-trail-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(['When (UTC),User,Email,Role,Actor ID,Simulated,Area,Action,Reference,Detail', ...rows.map(r => [r.at, r.user_name, r.user_email, r.role, r.actor_id, r.simulated ? 'Yes' : 'No', r.module, r.action, r.ref, r.detail].map(esc).join(','))].join('\n'));
}));
adminRouter.get('/audit/workflow', allow('audit', 'r'), h((req, res) => {
  const q = str(req.query.q, 80);
  const where = q ? 'WHERE ref LIKE ? OR actor_name LIKE ? OR detail LIKE ? OR event LIKE ?' : '';
  const p = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];
  res.json({ events: all(`SELECT * FROM workflow_events ${where} ORDER BY id DESC LIMIT 300`, p).map(e => ({ ...e, toLabel: STATUS_LABEL[e.to_status] || e.to_status })),
    records: all(`SELECT * FROM acknowledgements ${q ? 'WHERE ref LIKE ? OR actor_name LIKE ? OR action LIKE ? OR comment LIKE ?' : ''} ORDER BY id DESC LIMIT 300`, p) });
}));
