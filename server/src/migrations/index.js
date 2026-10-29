// ============================================================================
// Database migrations. Applied in order on start-up (and by `npm run migrate`)
// and recorded in schema_migrations. Never edit a migration that has shipped —
// add a new one.
//   001_v3_baseline        the v3 (bml-exit-form) schema, unchanged
//   002_release_management the merged v2 + v3 model: employees (mock HRIS),
//                          questionnaire versions, workflow history, digital
//                          acknowledgements, notifications, integration events,
//                          and immutability triggers on history tables
//   003_simplified_workflow ExitBuddy questionnaire only, mandatory ER meeting
//                          with participants and one Meeting Remarks field,
//                          no closure approval, ER assessment, rehire, AI or
//                          problem-area settings. Old columns and history rows
//                          are kept; nothing historical is deleted.
// ============================================================================

const V3_SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT,
  permissions TEXT NOT NULL DEFAULT '{}', system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role_id INTEGER NOT NULL REFERENCES roles(id), active INTEGER NOT NULL DEFAULT 1, last_login TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sequences (prefix TEXT NOT NULL, year INTEGER NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (prefix, year));
CREATE TABLE IF NOT EXISTS exit_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, access_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'Released',
  employee_uid TEXT NOT NULL, name TEXT NOT NULL, job_title TEXT, division TEXT NOT NULL, department TEXT, unit TEXT, line_manager TEXT,
  date_joined TEXT, last_day TEXT NOT NULL, exit_type TEXT NOT NULL DEFAULT 'Resignation', notice_date TEXT, note_to_staff TEXT,
  released_by TEXT, released_at TEXT NOT NULL DEFAULT (datetime('now')), acknowledged_at TEXT,
  personal_email TEXT, mobile TEXT, contact_method TEXT,
  answers TEXT NOT NULL DEFAULT '{}', draft TEXT NOT NULL DEFAULT '{}', submitted_at TEXT, entered_by TEXT,
  classification TEXT CHECK (classification IN ('Regrettable','Non-regrettable')),
  reminder_at TEXT, closed_at TEXT, deleted_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_exit_status ON exit_interviews(status);
CREATE INDEX IF NOT EXISTS ix_exit_division ON exit_interviews(division);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, exit_id INTEGER NOT NULL REFERENCES exit_interviews(id), date TEXT NOT NULL, time TEXT NOT NULL,
  mode TEXT NOT NULL, location TEXT, interviewer TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Scheduled',
  attendees TEXT, discussion TEXT, staff_points TEXT, agreed_steps TEXT, minutes_by TEXT, minutes_at TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, exit_id INTEGER NOT NULL REFERENCES exit_interviews(id), body TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')), user_name TEXT, user_email TEXT, role TEXT,
  module TEXT, action TEXT NOT NULL, ref TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')), engine TEXT NOT NULL, filters TEXT,
  result TEXT NOT NULL, created_by TEXT);
`;

function addColumn(m, table, col, def) {
  if (!m.columns(table).includes(col)) m.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export const MIGRATIONS = [
  { id: '001_v3_baseline', up: m => m.exec(V3_SCHEMA) },

  { id: '002_release_management', up: m => {
    // Mock HRIS employee records (future source: MiHCM / approved HRIS endpoint).
    m.exec(`CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, job_title TEXT, grade TEXT,
      division TEXT NOT NULL, department TEXT, unit TEXT, line_manager TEXT, date_joined TEXT,
      work_email TEXT, status TEXT NOT NULL DEFAULT 'Active', source TEXT NOT NULL DEFAULT 'mock-hris',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);

    // Release / case columns.
    addColumn(m, 'exit_interviews', 'employee_ref', 'INTEGER REFERENCES employees(id)');
    addColumn(m, 'exit_interviews', 'grade', 'TEXT');
    addColumn(m, 'exit_interviews', 'questionnaire_version', 'INTEGER NOT NULL DEFAULT 1');
    addColumn(m, 'exit_interviews', 'assigned_to', 'INTEGER REFERENCES users(id)');
    addColumn(m, 'exit_interviews', 'form_started_at', 'TEXT');
    addColumn(m, 'exit_interviews', 'link_expires_at', 'TEXT');
    addColumn(m, 'exit_interviews', 'withdrawn_at', 'TEXT');
    addColumn(m, 'exit_interviews', 'withdrawn_reason', 'TEXT');
    addColumn(m, 'exit_interviews', 'closure_requested_at', 'TEXT');
    addColumn(m, 'exit_interviews', 'closure_requested_by', 'TEXT');
    addColumn(m, 'exit_interviews', 'rehire', 'TEXT');
    addColumn(m, 'exit_interviews', 'source', `TEXT NOT NULL DEFAULT 'app'`);   // app | mihcm | oneui | import-v2
    addColumn(m, 'exit_interviews', 'external_id', 'TEXT');
    addColumn(m, 'meetings', 'updated_at', 'TEXT');
    addColumn(m, 'meetings', 'interviewer_id', 'INTEGER REFERENCES users(id)');

    // Users and roles: titles, dashboards, demo personas.
    addColumn(m, 'users', 'title', 'TEXT');
    addColumn(m, 'users', 'employee_id', 'TEXT');
    addColumn(m, 'users', 'persona', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(m, 'roles', 'dashboard', `TEXT NOT NULL DEFAULT 'er'`);
    addColumn(m, 'roles', 'sort', 'INTEGER NOT NULL DEFAULT 50');

    // Audit: identity id and simulated flag.
    addColumn(m, 'audit_log', 'actor_id', 'TEXT');
    addColumn(m, 'audit_log', 'simulated', 'INTEGER NOT NULL DEFAULT 0');

    // Versioned questionnaires. Published versions are frozen; records keep
    // the version they answered.
    m.exec(`CREATE TABLE IF NOT EXISTS questionnaires (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
      is_default INTEGER NOT NULL DEFAULT 0, based_on INTEGER, note TEXT, questions TEXT NOT NULL DEFAULT '[]',
      created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), published_by TEXT, published_at TEXT)`);

    // Workflow history — append only.
    m.exec(`CREATE TABLE IF NOT EXISTS workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')),
      exit_id INTEGER NOT NULL REFERENCES exit_interviews(id), ref TEXT NOT NULL, event TEXT NOT NULL,
      from_status TEXT, to_status TEXT, actor_type TEXT NOT NULL, actor_id TEXT, actor_name TEXT, actor_role TEXT,
      detail TEXT, data TEXT, simulated INTEGER NOT NULL DEFAULT 0)`);
    m.exec('CREATE INDEX IF NOT EXISTS ix_wf_exit ON workflow_events(exit_id)');

    // Digital acknowledgement / confirmation records (replace signature lines).
    m.exec(`CREATE TABLE IF NOT EXISTS acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')),
      exit_id INTEGER NOT NULL REFERENCES exit_interviews(id), ref TEXT NOT NULL, action TEXT NOT NULL,
      actor_name TEXT NOT NULL, actor_id TEXT, actor_role TEXT, status TEXT NOT NULL DEFAULT 'Completed electronically',
      comment TEXT, source TEXT NOT NULL DEFAULT 'app', simulated INTEGER NOT NULL DEFAULT 0, event_id INTEGER REFERENCES workflow_events(id))`);
    m.exec('CREATE INDEX IF NOT EXISTS ix_ack_exit ON acknowledgements(exit_id)');

    // Notifications (mock Teams / email now; Microsoft Graph later).
    m.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')), event TEXT NOT NULL,
      exit_id INTEGER REFERENCES exit_interviews(id), ref TEXT, channel TEXT NOT NULL, audience TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id), employee_id TEXT, recipient_name TEXT NOT NULL, recipient_role TEXT,
      title TEXT NOT NULL, body TEXT, link TEXT, detail_level TEXT NOT NULL DEFAULT 'full',
      status TEXT NOT NULL DEFAULT 'Pending', provider TEXT NOT NULL DEFAULT 'mock', attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, delivered_at TEXT, read_at TEXT)`);
    m.exec('CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id)');

    // Integration events (inbound from MiHCM / OneUI, outbound status sync).
    m.exec(`CREATE TABLE IF NOT EXISTS integration_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')), direction TEXT NOT NULL,
      system TEXT NOT NULL, event_type TEXT NOT NULL, external_id TEXT, ref TEXT, payload TEXT,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, processed_at TEXT, simulated INTEGER NOT NULL DEFAULT 1)`);
    m.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_integration_external ON integration_events(system, direction, external_id) WHERE external_id IS NOT NULL');

    // History tables cannot be changed or deleted, even by the application.
    for (const t of ['audit_log', 'workflow_events', 'acknowledgements']) {
      m.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END`);
      m.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END`);
    }

    // Upgrade a v3 database: records answered the ExitBuddy form (version 1),
    // "submissions" permissions become cases + responses, deleted → withdrawn.
    m.run('UPDATE exit_interviews SET questionnaire_version = 1 WHERE questionnaire_version IS NULL OR questionnaire_version = 0');
    for (const r of m.all('SELECT id, permissions FROM roles')) {
      const p = JSON.parse(r.permissions || '{}');
      if (p.submissions) {
        p.cases = { ...p.submissions };
        if (p.submissions.r) p.responses = { r: true };
        delete p.submissions;
        if (p.analytics?.r) p.reports = { r: true };
        m.run('UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(p), r.id]);
      }
    }
    m.run(`UPDATE exit_interviews SET withdrawn_at = deleted_at, withdrawn_reason = 'Deleted in v3', status = 'Withdrawn' WHERE deleted_at IS NOT NULL AND withdrawn_at IS NULL`);
  } },

  { id: '003_simplified_workflow', up: m => {
    // ---- Questionnaire: ExitBuddy (v1) is the only one in use. Other versions
    // are retired but kept, so answers already given to them stay readable.
    m.run(`UPDATE questionnaires SET is_default = CASE WHEN version = 1 THEN 1 ELSE 0 END,
             status = CASE WHEN version = 1 THEN 'published' ELSE 'retired' END,
             name = CASE WHEN version = 1 THEN 'ExitBuddy exit interview' ELSE name END`);
    m.run(`DELETE FROM questionnaires WHERE status = 'draft'`);
    // Unsubmitted forms move to ExitBuddy; a draft in another version's codes is cleared.
    m.run(`UPDATE exit_interviews SET questionnaire_version = 1, draft = '{}' WHERE questionnaire_version != 1 AND submitted_at IS NULL`);

    // ---- Meetings: record reference, one Meeting Remarks field, conducted stamp.
    addColumn(m, 'meetings', 'ref', 'TEXT');
    addColumn(m, 'meetings', 'remarks', 'TEXT');
    addColumn(m, 'meetings', 'conducted_at', 'TEXT');
    addColumn(m, 'meetings', 'conducted_by', 'TEXT');
    for (const mt of m.all(`SELECT m.id, m.exit_id, m.status, m.discussion, m.staff_points, m.agreed_steps, m.minutes_at, m.minutes_by, e.ref
                            FROM meetings m JOIN exit_interviews e ON e.id = m.exit_id ORDER BY m.exit_id, m.id`)) {
      const n = m.get('SELECT COUNT(*) AS n FROM meetings WHERE exit_id = ? AND id <= ?', [mt.exit_id, mt.id]).n;
      // Old minutes (summary, matters raised, next steps) become one remarks text.
      const remarks = [mt.discussion, mt.staff_points && `Matters raised by the employee: ${mt.staff_points}`, mt.agreed_steps && `Agreed next steps: ${mt.agreed_steps}`].filter(Boolean).join('\n\n') || null;
      m.run(`UPDATE meetings SET ref = COALESCE(ref, ?), remarks = COALESCE(remarks, ?),
               conducted_at = COALESCE(conducted_at, CASE WHEN status = 'Held' THEN minutes_at END),
               conducted_by = COALESCE(conducted_by, CASE WHEN status = 'Held' THEN minutes_by END) WHERE id = ?`,
        [`${mt.ref}/M${n}`, mt.status === 'Held' ? remarks : null, mt.id]);
    }
    // Additional participants. The employee and the responsible ER officer
    // (interviewer) are always required participants and are not stored here.
    m.exec(`CREATE TABLE IF NOT EXISTS meeting_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL REFERENCES meetings(id),
      user_id INTEGER REFERENCES users(id), name TEXT NOT NULL, email TEXT, role TEXT,
      added_by TEXT, added_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    m.exec('CREATE INDEX IF NOT EXISTS ix_mp_meeting ON meeting_participants(meeting_id)');

    // ---- No closure approval: pending requests go back to their real status.
    for (const r of m.all(`SELECT id, ref, status FROM exit_interviews WHERE closure_requested_at IS NOT NULL AND closed_at IS NULL`)) {
      const held = m.get(`SELECT 1 FROM meetings WHERE exit_id = ? AND status = 'Held'`, [r.id]);
      const sched = m.get(`SELECT 1 FROM meetings WHERE exit_id = ? AND status = 'Scheduled'`, [r.id]);
      const to = held ? 'Interviewed' : sched ? 'Meeting scheduled' : 'Submitted';
      m.run('UPDATE exit_interviews SET closure_requested_at = NULL, closure_requested_by = NULL, status = ? WHERE id = ?', [to, r.id]);
      m.run(`INSERT INTO workflow_events (exit_id, ref, event, from_status, to_status, actor_type, actor_name, actor_role, detail)
             VALUES (?,?, 'record.migrated', ?, ?, 'system', 'System', 'System', 'Closure approval step removed; the ER officer completes the exit directly')`, [r.id, r.ref, r.status, to]);
    }

    // ---- Permissions: closure approval and AI insights no longer exist;
    // the questionnaire is view-only.
    for (const r of m.all('SELECT id, permissions FROM roles')) {
      const p = JSON.parse(r.permissions || '{}');
      delete p.approvals; delete p.ai;
      if (p.questionnaire) p.questionnaire = p.questionnaire.r ? { r: true } : undefined;
      m.run('UPDATE roles SET permissions = ?, description = REPLACE(description, ?, ?) WHERE id = ?',
        [JSON.stringify(p), '; approves case closure', '; dashboards and reporting', r.id]);
    }
    m.run(`UPDATE roles SET description = 'View-only: ER overview, statuses, reports and analytics' WHERE name = 'ER Head'`);

    // ---- Settings: drop removed options and notification rules.
    const setting = k => { const row = m.get('SELECT value FROM settings WHERE key = ?', [k]); return row ? JSON.parse(row.value) : null; };
    const put = (k, v) => m.run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(v), k]);
    for (const k of ['ragRed', 'ragGreen', 'alertExitsPerMonth', 'managerRiskExits', 'headcount', 'ai']) m.run('DELETE FROM settings WHERE key = ?', [k]);
    const w = setting('workflow');
    if (w) { delete w.meetingRequired; delete w.closeRequiresApproval; put('workflow', w); }
    const rules = setting('notificationRules');
    if (rules) {
      const label = { 'case.closed': 'Exit completed', 'case.overdue': 'ER meeting overdue', 'meeting.scheduled': 'ER meeting scheduled', 'meeting.changed': 'ER meeting rescheduled or cancelled' };
      put('notificationRules', rules.filter(r => !['case.closure_requested', 'case.regrettable', 'exit.spike'].includes(r.event)).map(r => {
        const out = { ...r, label: label[r.event] || r.label };
        if (r.event.startsWith('meeting.') && !r.recipients.some(x => x.type === 'participants')) out.recipients = [...r.recipients, { type: 'participants', detail: 'full' }];
        if (r.event === 'case.closed' && !r.recipients.some(x => x.type === 'employee')) out.recipients = [{ type: 'employee', detail: 'full' }, ...r.recipients];
        return out;
      }));
    }
  } },
];
