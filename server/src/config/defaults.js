// ============================================================================
// DEFAULTS written by `npm run seed` (and added on upgrade when missing).
// After seeding, change them in the app (Administration pages).
// Authorization is stored as ROLES with permissions; users are linked to a
// role. Nothing in the code checks a person's name.
// ============================================================================

export const EXIT_TYPES = ['Resignation', 'End of contract', 'Retirement', 'Mutual separation', 'Termination'];

export const DEFAULT_SETTINGS = {
  appName: 'ExitBuddy',
  companyName: 'Bank',                       // "the {company}" in questions
  orgName: 'Bank of Maldives',               // printed documents
  brandTheme: 'teal',                        // teal | exitbuddy
  timezone: 'Indian/Maldives',               // display time zone (stored in UTC)
  divisions: [
    'Retail Banking', 'Corporate Banking', 'SME Banking', 'Credit', 'Risk', 'Finance',
    'Operations', 'Technology', 'Marketing & Communications', 'People & Culture',
    'Legal & Compliance', 'Internal Audit',
  ],
  minResponses: 3,          // averages from fewer responses are flagged "insufficient data"
  suppressBelow: 3,         // privacy: groups smaller than this are hidden from viewers without access to responses
  workflow: {
    acknowledgementSource: 'app',     // app | oneui  (oneui = OneUI/MiHCM is the authoritative acknowledgement)
    requireAcknowledgement: true,     // acknowledge before the form opens
    reminderAfterDays: 3,             // "reminder due" when no form after N days
    noResponseAfterLastDay: 7,        // "No response" N days after the last working day
    linkValidDaysAfterLastDay: 14,    // employee link stops working N days after the last working day
    overdueAfterDays: 7,              // submitted form with no meeting after N days = overdue
    // The ER exit interview meeting is mandatory and there is no approval step:
    // an exit is completed only after a meeting is conducted and its remarks recorded.
    defaultAssigneeRole: 'Lead ER Officer',
  },
  notifications: { provider: 'mock', mockFailureRate: 0, maxAttempts: 3 },
  integrations: {
    mihcm: { mode: 'mock', note: 'Endpoints to be confirmed with MiHCM / HRIS team' },
    oneui: { mode: 'mock', syncAcknowledgement: true, note: 'Endpoints to be confirmed with OneUI team' },
    teams: { mode: 'mock', note: 'Microsoft Graph / Teams configuration pending M365 approval' },
    simulateFailure: false,
  },
};

// Permission areas. ops = which of C (create) R (view) U (edit) D (delete) apply.
export const MODULES = [
  { key: 'releases', label: 'Staff releases', help: 'Initiate, view, correct and withdraw releases', ops: ['c', 'r', 'u', 'd'] },
  { key: 'cases', label: 'Exit cases', help: 'Case list and status; edit = assign and complete exits; create = enter a paper form', ops: ['c', 'r', 'u', 'd'] },
  { key: 'responses', label: 'Confidential responses', help: 'Individual exit form answers and comments', ops: ['r'] },
  { key: 'meetings', label: 'ER meetings & remarks', help: 'Schedule the mandatory ER meeting, manage participants, record meeting remarks', ops: ['c', 'r', 'u', 'd'] },
  { key: 'notes', label: 'Confidential ER notes', help: 'Internal ER notes on a case', ops: ['c', 'r', 'u', 'd'] },
  { key: 'analytics', label: 'Analytics', help: 'Exit interview dashboards', ops: ['r'] },
  { key: 'reports', label: 'Reports', help: 'View (read) and export (create) reports', ops: ['c', 'r'] },
  { key: 'questionnaire', label: 'Exit interview questions', help: 'View the ExitBuddy questionnaire', ops: ['r'] },
  { key: 'notifications', label: 'Notification centre (all)', help: 'See every notification; edit = retry and settings', ops: ['r', 'u'] },
  { key: 'integrations', label: 'Integration settings', help: 'OneUI / MiHCM / Teams settings and events', ops: ['r', 'u'] },
  { key: 'audit', label: 'Audit trail & exports', help: 'Audit trail, workflow history, exports', ops: ['r'] },
  { key: 'config', label: 'Workflow & application settings', help: 'Workflow rules, thresholds, branding, demo reset', ops: ['r', 'u'] },
  { key: 'users', label: 'Users, roles & permissions', help: 'Who has access and what each role can do', ops: ['c', 'r', 'u', 'd'] },
];

const all = Object.fromEntries(MODULES.map(m => [m.key, Object.fromEntries(m.ops.map(o => [o, true]))]));
const p = spec => Object.fromEntries(Object.entries(spec).map(([k, ops]) => [k, Object.fromEntries([...ops].map(o => [o, true]))]));

// dashboard: which landing dashboard the role sees (admin | er | executive | recruitment | audit)
export const DEFAULT_ROLES = [
  { name: 'System Admin', sort: 1, dashboard: 'admin', system: 1, description: 'Full system administration', permissions: all },
  { name: 'ER Manager', sort: 2, dashboard: 'er', description: 'ER management and oversight; dashboards and reporting',
    permissions: p({ releases: 'r', cases: 'crud', responses: 'r', meetings: 'crud', notes: 'crud', analytics: 'r', reports: 'cr', questionnaire: 'r', notifications: 'r', audit: 'r', config: 'r', users: 'r' }) },
  { name: 'Lead ER Officer', sort: 3, dashboard: 'er', description: 'ER case management and processing',
    permissions: p({ releases: 'r', cases: 'cru', responses: 'r', meetings: 'cru', notes: 'cru' }) },
  { name: 'ER Head', sort: 4, dashboard: 'er', description: 'View-only: ER overview, statuses, reports and analytics',
    permissions: p({ releases: 'r', cases: 'r', analytics: 'r', reports: 'r' }) },
  { name: 'Director of People and Culture', sort: 5, dashboard: 'executive', description: 'Executive oversight; view-only',
    permissions: p({ analytics: 'r', reports: 'r' }) },
  { name: 'Recruitment Officer', sort: 6, dashboard: 'recruitment', description: 'Initiates staff releases and tracks acknowledgement; no access to interview responses',
    permissions: p({ releases: 'crud' }) },
  { name: 'Auditor', sort: 7, dashboard: 'audit', description: 'Read-only: audit trail, exports and authorized case records',
    permissions: p({ cases: 'r', audit: 'r', users: 'r', config: 'r' }) },
];

// The five named users, plus demo personas (fictional, persona = 1).
export const DEFAULT_USERS = [
  { name: 'Aminath Azwa Moosa', email: 'azwa.moosa@bank.example', title: 'HR Analyst', role: 'System Admin' },
  { name: 'Fathimath Rayya Hilmy', email: 'rayya.hilmy@bank.example', title: 'ER Manager', role: 'ER Manager' },
  { name: 'Aishath Ish-ha Loreef', email: 'ishha.loreef@bank.example', title: 'Lead ER Officer', role: 'Lead ER Officer' },
  { name: 'Fathimath Shaiha Ahmed Ziyaf', email: 'shaiha.ziyaf@bank.example', title: 'ER Head (view only)', role: 'ER Head' },
  { name: 'Mohamed Maiz', email: 'mohamed.maiz@bank.example', title: 'Director of People and Culture', role: 'Director of People and Culture' },
  { name: 'Recruitment Officer (Demo)', email: 'recruitment.demo@bank.example', title: 'Recruitment Officer', role: 'Recruitment Officer', persona: 1 },
  { name: 'Auditor (Demo)', email: 'auditor.demo@bank.example', title: 'Internal Auditor', role: 'Auditor', persona: 1 },
];

// Who is notified for each event. Recipients are ROLES (resolved to role ids
// at seed time), the employee, the case assignee, the meeting interviewer or
// the meeting's participants (configured users only).
// The internal event key for exit completion stays 'case.closed' so existing
// history and rules keep working; it is shown as "Exit completed".
// detail: full = case details; summary = no confidential details.
export const DEFAULT_NOTIFICATION_RULES = [
  { event: 'release.initiated', label: 'Release initiated', recipients: [{ type: 'employee' }, { type: 'assignee' }, { type: 'role', role: 'ER Manager' }, { type: 'role', role: 'ER Head', detail: 'summary' }] },
  { event: 'release.acknowledged', label: 'Release acknowledged', recipients: [{ type: 'assignee' }, { type: 'role', role: 'Recruitment Officer' }] },
  { event: 'form.submitted', label: 'Exit form submitted', recipients: [{ type: 'assignee' }, { type: 'role', role: 'ER Manager' }, { type: 'role', role: 'ER Head', detail: 'summary' }] },
  { event: 'meeting.scheduled', label: 'ER meeting scheduled', recipients: [{ type: 'employee' }, { type: 'interviewer' }, { type: 'participants' }] },
  { event: 'meeting.changed', label: 'ER meeting rescheduled or cancelled', recipients: [{ type: 'employee' }, { type: 'interviewer' }, { type: 'participants' }] },
  { event: 'case.assigned', label: 'Case assigned', recipients: [{ type: 'assignee' }] },
  { event: 'case.closed', label: 'Exit completed', recipients: [{ type: 'employee' }, { type: 'assignee' }, { type: 'role', role: 'Recruitment Officer', detail: 'summary' }, { type: 'role', role: 'ER Head', detail: 'summary' }] },
  { event: 'case.overdue', label: 'ER meeting overdue', recipients: [{ type: 'assignee' }, { type: 'role', role: 'ER Manager' }] },
  { event: 'release.reminder', label: 'Reminder to employee', recipients: [{ type: 'employee' }] },
  { event: 'release.withdrawn', label: 'Release withdrawn', recipients: [{ type: 'employee' }, { type: 'assignee' }] },
  { event: 'integration.failed', label: 'Integration error', recipients: [{ type: 'role', role: 'System Admin' }] },
  { event: 'notification.failed', label: 'Notification delivery failed', recipients: [{ type: 'role', role: 'System Admin' }] },
];
