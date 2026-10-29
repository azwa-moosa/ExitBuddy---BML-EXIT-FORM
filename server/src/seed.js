// ============================================================================
// npm run seed — creates a FRESH demo database (deletes the old one).
// All people, employee IDs and comments are FICTIONAL. Every demo action is
// recorded through the real services, marked "simulated".
// ============================================================================
import './env.js';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb, run, get, tx, setSetting, dbFile, closeDb } from './db.js';
import { DEFAULT_SETTINGS, DEFAULT_ROLES, DEFAULT_USERS, DEFAULT_NOTIFICATION_RULES } from './config/defaults.js';
import { resolveRules, ensureReferenceData } from './bootstrap.js';
import { ensureQuestionnaires } from './services/questionnaire.js';
import { createRelease, acknowledgeRelease, submitForm, saveDraft, withdrawRelease } from './services/releases.js';
import { recordEvent, loadCase } from './services/workflow.js';
import { notify } from './services/notify.js';
import { outbound, recordInbound, setInboundRef } from './services/integrations.js';

let seed = 20261025;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dt = (date, time = '09:00:00') => `${date} ${time}`;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const FIRST = ['Mariyam', 'Aminath', 'Fathimath', 'Aishath', 'Hawwa', 'Ahmed', 'Mohamed', 'Ibrahim', 'Ali', 'Hassan', 'Hussain', 'Ismail', 'Shifa', 'Nashid', 'Zahir', 'Leena', 'Raisha', 'Shamin', 'Yoosuf', 'Mausoom', 'Nazra', 'Faruhan', 'Azim', 'Shazna'];
const LAST = ['Shareef', 'Rasheed', 'Naseem', 'Waheed', 'Hameed', 'Saeed', 'Adam', 'Riyaz', 'Zuhair', 'Faisal', 'Latheef', 'Manik', 'Didi', 'Shafeeq', 'Nizam', 'Jaleel'];
const TITLES = ['Officer', 'Senior Officer', 'Analyst', 'Senior Analyst', 'Assistant Manager', 'Relationship Manager', 'Engineer', 'Associate', 'Risk Analyst'];
const GRADES = ['G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const DEPTS = {
  'Retail Banking': [['Branch Network', ['Malé Branch', 'Hulhumalé Branch']], ['Cards', ['Card Operations']], ['Contact Centre', ['Inbound']]],
  'Corporate Banking': [['Relationship Management', ['Tourism']], ['Trade Finance', ['Imports']]],
  'SME Banking': [['SME Relationship', ['Atolls']], ['SME Credit', ['Appraisal']]],
  'Credit': [['Portfolio Risk', ['Monitoring']], ['Corporate Credit', ['Appraisal']]],
  'Risk': [['Market Risk', ['Treasury Risk']], ['Operational Risk', ['Controls']]],
  'Finance': [['Financial Reporting', ['Statutory']], ['Treasury', ['Dealing']]],
  'Operations': [['Central Operations', ['Clearing']], ['Payments', ['Remittances']], ['Product', ['Retail Products']]],
  'Technology': [['Infrastructure', ['Network']], ['Digital Channels', ['Mobile App']], ['Application Support', ['Core Banking']]],
  'Marketing & Communications': [['Brand', ['Campaigns']], ['Digital Marketing', ['Social']]],
  'People & Culture': [['Talent Acquisition', ['Recruitment']], ['Learning', ['Programmes']]],
  'Legal & Compliance': [['Compliance', ['AML']], ['Legal', ['Advisory']]],
  'Internal Audit': [['Audit', ['IT Audit']]],
};
// Fictional line managers (manager risk needs repeats).
const MANAGERS = { 'Retail Banking': ['Ahmed Saeed', 'Ahmed Saeed', 'Mariyam Riyaz'], 'Credit': ['Ibrahim Waheed', 'Hawwa Latheef'], 'Operations': ['Hussain Adam', 'Nashid Faisal'], 'Technology': ['Zahir Manik', 'Leena Hameed'] };
// [division, exits, base rating, ExitBuddy reasons]
const PLAN = [
  ['Retail Banking', 8, 2.1, ['Career advancement', 'Manager relationship', 'Work-life balance', 'Higher pay']],
  ['Operations', 5, 2.4, ['Higher pay', 'Better benefits', 'Career advancement']],
  ['Credit', 5, 2.2, ['Manager relationship', 'Career advancement', 'Higher pay']],
  ['Technology', 4, 3.0, ['Higher pay', 'Work-life balance', 'Career change']],
  ['Risk', 3, 2.9, ['Higher pay', 'Career advancement']],
  ['SME Banking', 3, 3.2, ['Work-life balance', 'Manager relationship']],
  ['Corporate Banking', 2, 3.7, ['Career advancement']],
  ['Finance', 2, 4.0, ['Personal/family']],
  ['Marketing & Communications', 1, 4.1, ['Career change']],
  ['People & Culture', 1, 4.3, ['Personal/family']],
  ['Legal & Compliance', 1, 3.8, ['Personal/family']],
];
const COMMENTS = {
  career: ['Introduce a transparent promotion framework. The current system rewards tenure over talent.', 'Promotions are not merit-based; I stayed in the same grade for four years.', 'A clear path to a team lead role. I asked twice and was told to wait.'],
  pay: ['Compensation has not kept up with inflation or the market.', 'The offer elsewhere was 30% higher with better allowances.', 'Salary benchmarking against other banks is overdue for technical roles.'],
  manager: ['My manager blocked my progression and rarely gave feedback.', 'Better coaching from my supervisor would have kept me.', 'Managers need training on how to lead people, not just targets.'],
  workload: ['Constant overtime during month end with no recognition.', 'Workload was too high after two people left and were not replaced.', 'More flexible working would have made a big difference.'],
  other: ['Starting a master’s programme abroad.', 'Moving to another island with my family.', 'I want to try a different profession.'],
  final: ['Three of my closest colleagues have also left in the past six months.', 'Thank you for the opportunities. Please listen to frontline staff.', 'The team was great; leadership needs to communicate strategy better.', ''],
};
const themeOf = { 'Career advancement': 'career', 'Higher pay': 'pay', 'Better benefits': 'pay', 'Manager relationship': 'manager', 'Work-life balance': 'workload' };

function answers(base, reasons) {
  const q1 = [...new Set([pick(reasons), rnd() < 0.6 ? pick(reasons) : null, rnd() < 0.12 ? 'Other' : null].filter(Boolean))];
  const rating = clamp(Math.round(base + (rnd() - 0.5) * 1.6), 1, 5); const bad = rating <= 2;
  const a = {
    q1, q2: rating,
    q3: q1.includes('Manager relationship') ? 'Difficult' : bad ? pick(['Neutral', 'Difficult']) : pick(['Excellent', 'Good', 'Good', 'Neutral']),
    q4: q1.includes('Career advancement') ? pick(['No', 'Somewhat']) : bad ? pick(['Somewhat', 'No']) : pick(['Yes', 'Somewhat']),
    q5: bad ? pick(['Stressful', 'Stressful', 'Toxic', 'Neutral']) : pick(['Great', 'Good', 'Good', 'Neutral']),
    q6: bad ? pick(['Partially', 'No', 'Yes']) : pick(['Yes', 'Yes', 'Partially']),
    q7: pick(COMMENTS[themeOf[q1[0]] || 'other']),
    q8: bad ? pick(['Neither', 'Would refer only', 'Neither', 'Would return only']) : pick(['Both yes', 'Would return only', 'Would refer only', 'Both yes']),
    q9: pick(COMMENTS.final),
  };
  if (q1.includes('Other')) a.q1_other = 'Starting a master’s programme abroad';
  if (a.q4 !== 'Yes' && rnd() < 0.6) a.q4_comment = pick(COMMENTS.career);
  return a;
}
export async function seedDatabase({ quiet = false } = {}) {
  seed = 20261025;
  closeDb();
  if (fs.existsSync(dbFile())) fs.rmSync(dbFile());
  await openDb({ fresh: true });
  const TODAY = iso(new Date());

  tx(() => {
    Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => setSetting(k, v));
    const roleIds = {};
    DEFAULT_ROLES.forEach(r => { roleIds[r.name] = run('INSERT INTO roles (name, description, permissions, system, dashboard, sort) VALUES (?,?,?,?,?,?)',
      [r.name, r.description, JSON.stringify(r.permissions), r.system || 0, r.dashboard, r.sort]).id; });
    const userIds = {};
    DEFAULT_USERS.forEach(u => { userIds[u.name] = run('INSERT INTO users (name, email, title, role_id, persona) VALUES (?,?,?,?,?)', [u.name, u.email, u.title, roleIds[u.role], u.persona || 0]).id; });
    setSetting('notificationRules', resolveRules(DEFAULT_NOTIFICATION_RULES));
    setSetting('workflow', { ...DEFAULT_SETTINGS.workflow, defaultAssigneeUserId: userIds['Aishath Ish-ha Loreef'] });
    ensureQuestionnaires('System (seed)');
    ensureReferenceData();

    const U = n => { const id = userIds[n]; const role = DEFAULT_USERS.find(x => x.name === n).role; return { type: 'user', name: n, role, actorId: `U${String(id).padStart(3, '0')}`, userId: id, simulated: true }; };
    const recruiter = U('Recruitment Officer (Demo)'), lead = U('Aishath Ish-ha Loreef'), mgr = U('Fathimath Rayya Hilmy');
    const extraPeople = [{ user_id: userIds['Fathimath Rayya Hilmy'], name: 'Fathimath Rayya Hilmy', role: 'ER Manager' }, { user_id: null, name: 'Line manager (by invitation)', role: 'Line manager' }];

    // ---- mock HRIS employees
    const employees = [];
    let empNo = 10240;
    for (const div of DEFAULT_SETTINGS.divisions) {
      const count = div === 'Retail Banking' ? 14 : div === 'Internal Audit' ? 2 : 6;
      for (let i = 0; i < count; i++) {
        const [dept, units] = pick(DEPTS[div]);
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const e = { employee_id: `EMP-${empNo++}`, name, job_title: pick(TITLES), grade: pick(GRADES), division: div, department: dept, unit: pick(units),
          line_manager: MANAGERS[div] ? MANAGERS[div][i % MANAGERS[div].length] : `${pick(FIRST)} ${pick(LAST)}`,
          date_joined: addDays(TODAY, -between(500, 4800)), work_email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${empNo}@bank.example` };
        e.id = run(`INSERT INTO employees (employee_id, name, job_title, grade, division, department, unit, line_manager, date_joined, work_email) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [e.employee_id, e.name, e.job_title, e.grade, e.division, e.department, e.unit, e.line_manager, e.date_joined, e.work_email]).id;
        employees.push(e);
      }
    }
    const pool = div => employees.filter(e => e.division === div && !e.used);

    // ---- historic and live releases
    let k = 0; let liveIdx = 0;
    const cluster = addDays(TODAY, -75);
    const live = ['awaiting', 'ack', 'draft', 'submitted', 'overdue', 'scheduled', 'conducted', 'withdrawn'];
    PLAN.forEach(([division, count, base, reasons]) => {
      for (let i = 0; i < count; i++) {
        const e = pool(division)[0]; if (!e) break; e.used = true; k++;
        const stage = (k % 4 === 2 && liveIdx < live.length) ? live[liveIdx++] : (k % 13 === 0 ? 'noresponse' : 'done');
        const lastDay = stage === 'done' || stage === 'noresponse'
          ? (division === 'Retail Banking' && i < 6 ? addDays(cluster, between(0, 12)) : addDays(TODAY, -between(12, 260)))
          : addDays(TODAY, between(6, 26));
        const notice = addDays(lastDay, -between(28, 35));
        const relAt = dt(addDays(notice, 1), '09:10:00');
        const fromMiHCM = k === 9;
        const r = createRelease({ employee: e, details: { exit_type: pick(['Resignation', 'Resignation', 'Resignation', 'End of contract']), notice_date: notice, last_day: lastDay },
          actor: fromMiHCM ? { type: 'integration', name: 'MiHCM: release event', role: 'Integration', actorId: 'MiHCM', simulated: true } : recruiter,
          source: fromMiHCM ? 'mihcm' : 'app', externalId: fromMiHCM ? 'MIHCM-REL-0001' : null, at: relAt });
        if (fromMiHCM) { const ev = recordInbound('MiHCM', 'staff.release.initiated', 'SIM-SEED-0001', { eventType: 'staff.release.initiated', employeeId: e.employee_id, lastWorkingDay: lastDay }, 'Received'); setInboundRef(ev.id, r.ref, 'Processed'); }
        const emp = { type: 'employee', name: e.name, role: 'Employee', actorId: e.employee_id, simulated: true };
        if (stage === 'awaiting') continue;
        if (stage === 'withdrawn') { withdrawRelease(loadCase(r.id), recruiter, 'Resignation withdrawn by the employee'); continue; }
        if (stage === 'noresponse') { run(`UPDATE exit_interviews SET status = 'No response' WHERE id = ?`, [r.id]); recordEvent(r.id, 'no_response', { type: 'system', name: 'System', role: 'System' }, { at: dt(addDays(lastDay, 8), '02:00:00'), detail: 'No exit form 7 days after the last working day', forceStatus: 'No response' }); continue; }
        acknowledgeRelease(loadCase(r.id), emp, { at: dt(addDays(notice, 2), '10:05:00') });
        run(`UPDATE exit_interviews SET personal_email = ?, mobile = ?, contact_method = ? WHERE id = ?`, [`${e.name.toLowerCase().replace(/[^a-z]+/g, '.')}@mail.example`, `7${between(100000, 999999)}`, pick(['Email', 'Phone', 'Either']), r.id]);
        if (stage === 'ack') continue;
        const ans = answers(base, reasons);
        if (stage === 'draft') { saveDraft(loadCase(r.id), emp, { q1: ans.q1, q2: ans.q2 }, {}); continue; }
        const subAt = dt(addDays(notice, between(3, 9)), '19:00:00');
        submitForm(loadCase(r.id), emp, ans, {}, { at: subAt });
        if (stage === 'submitted') continue;
        if (stage === 'overdue') { run(`UPDATE exit_interviews SET submitted_at = ? WHERE id = ?`, [dt(addDays(TODAY, -12), '18:00:00'), r.id]); continue; }
        // Mandatory ER meeting: scheduled → conducted → Meeting Remarks → Complete Exit
        const interviewer = pick([lead, lead, mgr]);
        const mdate = stage === 'scheduled' ? addDays(TODAY, between(1, 4)) : addDays(subAt.slice(0, 10), between(1, 4));
        const schedAt = dt(addDays(subAt.slice(0, 10), 1), '09:30:00');
        const mref = `${r.ref}/M1`;
        const mid = run(`INSERT INTO meetings (exit_id, ref, date, time, mode, location, interviewer, interviewer_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [r.id, mref, mdate, pick(['10:00', '11:30', '14:00']), pick(['In person', 'Microsoft Teams', 'Phone']), 'P&C meeting room 2', interviewer.name, interviewer.userId, lead.name, schedAt]).id;
        const extras = rnd() < 0.5 ? [extraPeople[interviewer.userId === extraPeople[0].user_id ? 1 : 0]] : [];
        extras.forEach(p => run('INSERT INTO meeting_participants (meeting_id, user_id, name, role, added_by, added_at) VALUES (?,?,?,?,?,?)', [mid, p.user_id, p.name, p.role, lead.name, schedAt]));
        recordEvent(r.id, 'meeting.scheduled', lead, { at: schedAt, module: 'meetings', auditAction: 'Create', detail: `ER meeting ${mref} on ${mdate} with ${interviewer.name}${extras.length ? `; participants: ${extras.map(p => p.name).join(', ')}` : ''}` });
        notify('meeting.scheduled', loadCase(r.id), { meeting: get('SELECT * FROM meetings WHERE id = ?', [mid]), participants: extras }, schedAt);
        if (stage === 'scheduled') continue;
        const heldAt = dt(mdate, '15:00:00'); const remAt = dt(mdate, '16:00:00');
        run(`UPDATE meetings SET status = 'Held', conducted_at = ?, conducted_by = ?, remarks = ?, minutes_by = ?, minutes_at = ? WHERE id = ?`,
          [heldAt, interviewer.name, `Discussed the main reasons for leaving. ${ans.q7} ${pick(['Appreciated the team support.', 'Asked for the experience letter on the last day.', 'Would consider returning in two years.', 'Raised workload in the unit.'])} Experience letter to be issued on the last working day.`,
            interviewer.name, remAt, mid]);
        recordEvent(r.id, 'meeting.held', interviewer, { at: heldAt, module: 'meetings', auditAction: 'Edit', detail: `ER meeting ${mref} conducted`, ack: { action: 'ER meeting conducted', comment: `Meeting ${mdate}` } });
        recordEvent(r.id, 'meeting.remarks', interviewer, { at: remAt, module: 'meetings', auditAction: 'Create', detail: `Meeting remarks recorded (${mref})`, ack: { action: 'Meeting remarks recorded', comment: mref } });
        if (rnd() < 0.5) {
          run('INSERT INTO notes (exit_id, body, created_by, created_at) VALUES (?,?,?,?)', [r.id, pick(['Open conversation; reasons clear.', 'Offer from another bank confirmed; no counter-offer requested.', 'Positive about colleagues; frustrated with the promotion process.']), interviewer.name, dt(mdate, '16:20:00')]);
          recordEvent(r.id, 'note.added', interviewer, { at: dt(mdate, '16:20:00'), module: 'notes', auditAction: 'Create', detail: 'Confidential ER note added' });
        }
        if (stage === 'conducted') continue;
        if (mdate < addDays(TODAY, -10) && rnd() < 0.8) {
          const doneAt = dt(addDays(mdate, 1), '10:00:00');
          run(`UPDATE exit_interviews SET closed_at = ? WHERE id = ?`, [doneAt, r.id]);
          run(`UPDATE employees SET status = 'Exited' WHERE employee_id = ?`, [e.employee_id]);
          recordEvent(r.id, 'case.closed', interviewer, { at: doneAt, auditAction: 'Complete', detail: 'Exit completed', ack: { action: 'Exit completed' } });
          const fresh = loadCase(r.id);
          notify('case.closed', fresh, { actor: interviewer }, doneAt);
          outbound('exit.case.closed', fresh, { status: 'CLOSED', closedAt: doneAt }, doneAt);
        }
      }
    });

    // One failed outbound sync so the System Admin sees failure handling.
    setSetting('integrations', { ...DEFAULT_SETTINGS.integrations, simulateFailure: true });
    const anyAck = get(`SELECT id FROM exit_interviews WHERE acknowledged_at IS NOT NULL AND closed_at IS NULL ORDER BY id DESC LIMIT 1`);
    if (anyAck) outbound('release.acknowledgement.status', loadCase(anyAck.id), { status: 'ACKNOWLEDGED' });
    setSetting('integrations', { ...DEFAULT_SETTINGS.integrations, simulateFailure: false });
  });

  if (!quiet) {
    console.log(`\n  Seeded ${dbFile()}`);
    console.log('  Open the app and use the switcher in the header — no login needed in local development.\n');
  }
}

// Run directly: `npm run seed`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedDatabase();
}
