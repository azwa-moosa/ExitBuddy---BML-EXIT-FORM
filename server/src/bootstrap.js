// Makes sure reference data exists. Safe to run on every start: on a fresh
// seed it does nothing; on an upgraded v3 database it adds the new settings,
// questionnaires and notification rules without touching existing records.
import { all, get, run, getSettings, setSetting } from './db.js';
import { DEFAULT_SETTINGS, DEFAULT_NOTIFICATION_RULES } from './config/defaults.js';
import { ensureQuestionnaires } from './services/questionnaire.js';

export function resolveRules(rules) {
  const roleId = name => get('SELECT id FROM roles WHERE name = ?', [name])?.id;
  return rules.map(r => ({ ...r, enabled: r.enabled !== false,
    recipients: r.recipients.map(x => x.type === 'role' ? { type: 'role', roleId: x.roleId || roleId(x.role), detail: x.detail || 'full' } : { ...x, detail: x.detail || 'full' }).filter(x => x.type !== 'role' || x.roleId) }));
}

export function ensureReferenceData() {
  const s = getSettings();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in s)) setSetting(k, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) setSetting(k, { ...v, ...s[k] });
  }
  if (!s.notificationRules) setSetting('notificationRules', resolveRules(DEFAULT_NOTIFICATION_RULES));
  const w = getSettings().workflow;
  if (w && !w.defaultAssigneeUserId && w.defaultAssigneeRole) {
    const u = get(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = ? AND u.active = 1 ORDER BY u.id LIMIT 1`, [w.defaultAssigneeRole]);
    if (u) setSetting('workflow', { ...w, defaultAssigneeUserId: u.id });
  }
  ensureQuestionnaires();
  // Records created before workflow history existed get one "migrated" event.
  for (const r of all('SELECT e.id, e.ref, e.status, e.released_at FROM exit_interviews e WHERE NOT EXISTS (SELECT 1 FROM workflow_events w WHERE w.exit_id = e.id)')) {
    run(`INSERT INTO workflow_events (at, exit_id, ref, event, to_status, actor_type, actor_name, actor_role, detail) VALUES (?,?,?,?,?,'system','System','System','Record migrated from an earlier version')`,
      [r.released_at, r.id, r.ref, 'record.migrated', r.status]);
  }
}
