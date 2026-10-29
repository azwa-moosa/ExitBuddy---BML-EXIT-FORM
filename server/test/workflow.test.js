// Automated API tests: run with `npm test` (uses a temporary database).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-test-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.AUTH_MODE = 'dev';
delete process.env.NODE_ENV;

const db = await import('../src/db.js');
const { seedDatabase } = await import('../src/seed.js');
const { buildApp } = await import('../src/app.js');
const { ensureReferenceData } = await import('../src/bootstrap.js');
const identity = await import('../src/identity.js');

let server, base, ids = {};
const as = who => ({ Cookie: `exit_dev_identity=${encodeURIComponent(who)}` });
async function call(method, url, who, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(who ? as(who) : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* csv */ }
  return { status: res.status, data };
}

before(async () => {
  await seedDatabase({ quiet: true });
  db.tx(() => ensureReferenceData());
  server = buildApp({ onReset: () => seedDatabase({ quiet: true }) }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const { data } = await call('GET', '/dev/identities');
  for (const u of data.users) ids[u.role] = `u:${u.id}`;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('predefined users and personas with their role titles', async () => {
  const { data } = await call('GET', '/dev/identities');
  const names = data.users.map(u => `${u.name}|${u.role}`);
  for (const x of ['Aminath Azwa Moosa|System Admin', 'Fathimath Rayya Hilmy|ER Manager', 'Aishath Ish-ha Loreef|Lead ER Officer',
    'Fathimath Shaiha Ahmed Ziyaf|ER Head', 'Mohamed Maiz|Director of People and Culture', 'Recruitment Officer (Demo)|Recruitment Officer', 'Auditor (Demo)|Auditor'])
    assert.ok(names.includes(x), `missing ${x}`);
  assert.ok(data.employees.length > 0);
});

test('production refuses no-login mode', () => {
  process.env.NODE_ENV = 'production';
  assert.throws(() => identity.assertSafeConfig(), /Refusing to start/);
  assert.equal(identity.devMode(), false);
  delete process.env.NODE_ENV;
});

test('entra mode gives no identity and no dev switching', async () => {
  process.env.AUTH_MODE = 'entra';
  try {
    assert.equal((await call('GET', '/cases', ids['System Admin'])).status, 401);
    assert.equal((await call('GET', '/dev/identities')).status, 403);
  } finally { process.env.AUTH_MODE = 'dev'; }
});

let rel;
test('recruitment initiates a release and never sees responses', async () => {
  const R = ids['Recruitment Officer'];
  assert.equal((await call('GET', '/cases', R)).status, 403);
  const emps = (await call('GET', '/employees', R)).data.employees;
  const e = emps[0];
  assert.equal((await call('POST', '/releases', R, { employeeId: e.employee_id, details: { last_day: '2099-01-31', notice_date: '2098-12-31' } })).status, 400, 'needs confirmation');
  const out = await call('POST', '/releases', R, { employeeId: e.employee_id, confirmed: true, details: { exit_type: 'Resignation', last_day: '2099-01-31', notice_date: '2098-12-31' } });
  assert.equal(out.status, 201);
  assert.match(out.data.ref, /^EX\/\d{4}\/\d{4}$/);
  rel = out.data;
  const again = await call('POST', '/releases', R, { employeeId: e.employee_id, confirmed: true, details: { last_day: '2099-01-31' } });
  assert.equal(again.status, 409, 'no duplicate open release');
  const detail = await call('GET', `/releases/${rel.id}`, R);
  assert.equal(detail.data.release.answers, undefined);
  assert.ok(detail.data.records.some(r => r.action === 'Release initiated' && r.actor_role === 'Recruitment Officer'));
});

test('employee sees only the ExitBuddy questions, no grade / DOJ, contact details last', async () => {
  const L = `/public/exit/${rel.access_code}`;
  const view = (await call('GET', L)).data.release;
  assert.equal(view.questionnaire.version, undefined, 'no questionnaire version shown to the employee');
  assert.deepEqual(view.questionnaire.questions.map(q => q.code), ['q1', 'q1_other', 'q2', 'q3', 'q4', 'q4_comment', 'q5', 'q6', 'q7', 'q8', 'q9']);
  for (const k of ['grade', 'date_joined']) assert.equal(k in view.about, false, `${k} must not be shown`);
  assert.deepEqual(Object.keys(view.contact), ['personal_email', 'mobile', 'contact_method']);
  assert.ok(!view.questionnaire.questions.some(q => /meet|ER team/i.test(q.text)), 'no opt-out meeting question');
});

test('employee acknowledges, saves a draft and submits through the link', async () => {
  const L = `/public/exit/${rel.access_code}`;
  assert.equal((await call('POST', `${L}/submit`, null, { answers: {} })).status, 409, 'must acknowledge first');
  assert.equal((await call('POST', `${L}/acknowledge`)).status, 200);
  assert.equal((await call('PUT', `${L}/draft`, null, { answers: { q1: ['Higher pay'] }, about: {} })).status, 200);
  assert.equal((await call('GET', L)).data.release.status, 'Form in progress');
  const missing = await call('POST', `${L}/submit`, null, { answers: { q1: ['Higher pay'] } });
  assert.equal(missing.status, 400);
  assert.ok(missing.data.fields.includes('q2'));
  const ok = await call('POST', `${L}/submit`, null, { answers: { q1: ['Higher pay', 'Other'], q1_other: 'Moving abroad', q2: 4, q3: 'Good', q4: 'No', q5: 'Good', q6: 'Yes', q7: 'Clearer promotion path', q8: 'Both yes' }, about: { personal_email: 'x@mail.example' } });
  assert.equal(ok.status, 200);
  const records = (await call('GET', L)).data.release.records.map(r => r.action);
  assert.deepEqual(records, ['Release acknowledged', 'Exit interview form submitted']);
});

test('mandatory ER meeting with participants, one Meeting Remarks field, Complete Exit without approval', async () => {
  const lead = ids['Lead ER Officer']; const leadId = Number(lead.slice(2));
  const notes = (await call('GET', '/notifications', lead)).data.notifications;
  assert.ok(notes.some(n => n.event === 'form.submitted' && n.ref === rel.ref && n.status === 'Simulated' && /mock/i.test(n.channel)));
  const c0 = (await call('GET', `/cases/${rel.id}`, lead)).data.case;
  assert.equal(c0.answers.q7, 'Clearer promotion path');
  assert.equal(c0.employee.grade, undefined); assert.equal(c0.employee.date_joined, undefined);
  assert.equal(c0.classification, undefined); assert.equal(c0.rehire, undefined);
  assert.match(c0.completion_blocker, /mandatory/);
  const done0 = await call('POST', `/cases/${rel.id}/complete`, lead, {});
  assert.equal(done0.status, 409, 'cannot complete before the meeting');

  const { data: staff } = await call('GET', '/staff/er', lead);
  const mgrId = staff.people.find(u => u.role === 'ER Manager').id;
  const sch = await call('POST', `/cases/${rel.id}/meetings`, lead, { date: '2099-01-10', time: '10:00', mode: 'In person', interviewerId: leadId,
    participants: [{ userId: mgrId }, { name: 'Line manager', email: 'lm@bank.example' }, { userId: leadId }] });
  assert.equal(sch.status, 201);
  assert.equal((await call('POST', `/cases/${rel.id}/meetings`, lead, { date: '2099-01-11', time: '10:00', mode: 'Phone', interviewerId: leadId })).status, 409, 'one scheduled meeting at a time');
  let c = (await call('GET', `/cases/${rel.id}`, lead)).data.case;
  assert.equal(c.status, 'Meeting scheduled');
  let m = c.meetings[0];
  assert.equal(m.ref, `${rel.ref}/M1`);
  assert.deepEqual(m.participants.map(p => [p.name, p.required]), [[c.employee.name, true], ['Aishath Ish-ha Loreef', true], ['Fathimath Rayya Hilmy', false], ['Line manager', false]]);
  assert.ok((await call('GET', '/notifications', ids['ER Manager'])).data.notifications.some(n => n.event === 'meeting.scheduled' && n.ref === rel.ref), 'participant notified (mock)');

  // update participants before the meeting
  assert.equal((await call('PUT', `/meetings/${m.id}`, lead, { participants: [{ userId: mgrId }] })).status, 200);
  m = (await call('GET', `/cases/${rel.id}`, lead)).data.case.meetings[0];
  assert.deepEqual(m.participants.map(p => p.name).slice(2), ['Fathimath Rayya Hilmy']);

  // a no-show does not complete the exit
  assert.equal((await call('POST', `/meetings/${m.id}/remarks`, lead, { remarks: 'x' })).status, 409, 'remarks only after conducted');
  assert.equal((await call('PUT', `/meetings/${m.id}`, lead, { status: 'No show' })).status, 200);
  assert.equal((await call('POST', `/cases/${rel.id}/complete`, lead, {})).status, 409, 'no-show cannot complete');
  assert.equal((await call('GET', `/cases/${rel.id}`, lead)).data.case.action, 'Reschedule ER meeting');

  const s2 = await call('POST', `/cases/${rel.id}/meetings`, lead, { date: '2099-01-12', time: '11:00', mode: 'Microsoft Teams', interviewerId: leadId });
  assert.equal((await call('POST', `/meetings/${s2.data.id}/conducted`, lead, {})).status, 200);
  c = (await call('GET', `/cases/${rel.id}`, lead)).data.case;
  assert.equal(c.status, 'Interviewed');
  assert.equal(c.action, 'Record meeting remarks');
  assert.equal((await call('POST', `/cases/${rel.id}/complete`, lead, {})).status, 409, 'remarks needed');
  assert.equal((await call('POST', `/meetings/${s2.data.id}/remarks`, lead, { remarks: '' })).status, 400);
  assert.equal((await call('POST', `/meetings/${s2.data.id}/remarks`, lead, { remarks: 'Discussed reasons; workload raised; experience letter on last day.', discussion: 'ignored' })).status, 200);
  m = (await call('GET', `/cases/${rel.id}`, lead)).data.case.meetings.find(x => x.id === s2.data.id);
  assert.equal(m.ref, `${rel.ref}/M2`); assert.equal(m.minutes_by, 'Aishath Ish-ha Loreef'); assert.ok(m.minutes_at); assert.ok(m.conducted_at);
  assert.equal(m.discussion, null, 'only the Meeting Remarks field is stored');

  assert.equal((await call('POST', `/cases/${rel.id}/approve-closure`, ids['ER Manager'], {})).status, 404, 'approval endpoint removed');
  const fin = await call('POST', `/cases/${rel.id}/complete`, lead, {});
  assert.equal(fin.status, 200);
  const done = (await call('GET', `/cases/${rel.id}`, ids['ER Manager'])).data.case;
  assert.equal(done.status, 'Closed'); assert.equal(done.statusLabel, 'Exit completed');
  const acts = done.records.map(r => r.action);
  for (const a of ['Release initiated', 'Release acknowledged', 'Exit interview form submitted', 'ER meeting no-show recorded', 'ER meeting conducted', 'Meeting remarks recorded', 'Exit completed']) assert.ok(acts.includes(a), a);
  assert.ok(!acts.some(a => /closure|approv/i.test(a)));
  assert.ok(done.records.every(r => r.simulated === 1), 'demo actions are marked simulated');
  assert.ok(done.history.some(e => e.event === 'meeting.participants'));
  const audit = (await call('GET', `/audit?q=${encodeURIComponent(rel.ref)}`, ids['System Admin'])).data.entries.map(e => e.action);
  assert.ok(audit.includes('Complete'));
  assert.ok((await call('GET', '/notifications?scope=all', ids['System Admin'])).data.notifications.some(n => n.event === 'case.closed' && n.ref === rel.ref && n.audience === 'employee'));
  assert.equal((await call('POST', `/meetings/${s2.data.id}/remarks`, lead, { remarks: 'late edit' })).status, 409, 'remarks locked after completion');
});

test('removed modules are gone', async () => {
  const A = ids['System Admin'];
  for (const u of ['/analytics/problems', '/ai/latest', '/questionnaires']) assert.equal((await call('GET', u, A)).status, 404, u);
  assert.equal((await call('POST', `/cases/${rel.id}/classification`, A, { classification: 'Regrettable' })).status, 404);
  assert.equal((await call('POST', `/cases/${rel.id}/rehire`, A, { rehire: 'Eligible' })).status, 404);
  assert.equal((await call('POST', `/cases/${rel.id}/request-closure`, A, {})).status, 404);
  const mods = (await call('GET', '/modules', A)).data.modules.map(m => m.key);
  for (const k of ['approvals', 'ai']) assert.ok(!mods.includes(k), k);
  const ov = (await call('GET', '/analytics/overview', A)).data;
  for (const k of ['health', 'rehirePool']) assert.equal(k in ov, false, k);
  const q = (await call('GET', '/questionnaire', A)).data.questionnaire;
  assert.equal(q.name, 'ExitBuddy exit interview'); assert.equal(q.questions.length, 11);
});

test('view-only roles are enforced on the server', async () => {
  const head = ids['ER Head'], dir = ids['Director of People and Culture'], aud = ids['Auditor'], mgr = ids['ER Manager'];
  const c = (await call('GET', `/cases/${rel.id}`, head)).data.case;
  assert.equal(c.answers, undefined, 'ER Head does not see responses by default');
  assert.equal(c.notes, undefined);
  assert.equal((await call('POST', `/cases/${rel.id}/meetings`, head, {})).status, 403);
  assert.equal((await call('POST', `/cases/${rel.id}/complete`, head, {})).status, 403);
  assert.equal((await call('GET', '/cases', dir)).status, 403);
  assert.equal((await call('GET', '/analytics/overview', dir)).status, 200);
  assert.equal((await call('GET', '/analytics/overview', dir)).data.privacy, true, 'small groups suppressed');
  assert.equal((await call('GET', '/reports/cases.csv', dir)).status, 403);
  assert.equal((await call('GET', '/reports/summary', dir)).status, 200);
  assert.equal((await call('GET', '/analytics/overview', mgr)).status, 200, 'ER Manager keeps oversight');
  assert.equal((await call('GET', '/audit', mgr)).status, 200);
  assert.equal((await call('GET', '/audit', aud)).status, 200);
  assert.equal((await call('GET', `/cases/${rel.id}`, aud)).data.case.answers, undefined);
  assert.equal((await call('PUT', '/settings', aud, { appName: 'x' })).status, 403);
  const idsList = (await call('GET', '/dev/identities')).data.users;
  assert.equal(idsList.find(u => u.role === 'ER Head').viewOnly, true);
  assert.equal(idsList.find(u => u.role === 'Director of People and Culture').viewOnly, true);
  assert.equal(idsList.find(u => u.role === 'ER Manager').viewOnly, false);
});

test('history tables are append-only', () => {
  assert.throws(() => db.run('UPDATE audit_log SET detail = ? WHERE id = 1', ['x']), /append-only/);
  assert.throws(() => db.run('DELETE FROM workflow_events WHERE id = 1'), /append-only/);
  assert.throws(() => db.run('UPDATE acknowledgements SET actor_name = ? WHERE id = 1', ['x']), /append-only/);
});

test('withdrawal keeps history and revokes the link', async () => {
  const R = ids['Recruitment Officer'];
  const emp = (await call('GET', '/employees', R)).data.employees[0];
  const nr = (await call('POST', '/releases', R, { employeeId: emp.employee_id, confirmed: true, details: { last_day: '2099-03-31' } })).data;
  assert.equal((await call('POST', `/releases/${nr.id}/withdraw`, R, {})).status, 400, 'reason required');
  assert.equal((await call('POST', `/releases/${nr.id}/withdraw`, R, { reason: 'Resignation withdrawn' })).status, 200);
  assert.equal((await call('GET', `/public/exit/${nr.access_code}`)).status, 410);
  const hist = (await call('GET', `/releases/${nr.id}`, R)).data.history.map(e => e.event);
  assert.ok(hist.includes('release.initiated') && hist.includes('release.withdrawn'));
});

test('missing ratings are not counted as zero', async () => {
  const { normalize } = await import('../src/services/normalize.js');
  const { overview, prepare } = await import('../src/analytics.js');
  const mk = (q2, i) => ({ id: 900 + i, ref: `T${i}`, division: 'Risk', last_day: '2099-01-01', submitted_at: '2099-01-01', questionnaire_version: 1, answers: { q1: ['Higher pay'], ...(q2 == null ? {} : { q2 }) } });
  const rows = [mk(5, 1), mk(3, 2), mk(null, 3)];
  assert.equal(normalize(rows[2]).overall, null);
  const ov = overview(prepare(rows), db.getSettings());
  assert.equal(ov.avgRating, 4); assert.equal(ov.ratingN, 2);
});

test('mock notification failure and retry', async () => {
  const A = ids['System Admin'];
  assert.equal((await call('PUT', '/notification-settings', A, { mockFailureRate: 1, maxAttempts: 3 })).status, 200);
  const R = ids['Recruitment Officer'];
  const emp = (await call('GET', '/employees', R)).data.employees[0];
  const nr = (await call('POST', '/releases', R, { employeeId: emp.employee_id, confirmed: true, details: { last_day: '2099-04-30' } })).data;
  const failed = (await call('GET', '/notifications?scope=all', A)).data.notifications.find(n => n.ref === nr.ref && n.status === 'Failed');
  assert.ok(failed, 'a failed notification exists');
  await call('PUT', '/notification-settings', A, { mockFailureRate: 0, maxAttempts: 3 });
  const retried = await call('POST', `/notifications/${failed.id}/retry`, A);
  assert.equal(retried.data.notification.status, 'Simulated');
});

test('inbound MiHCM release event (mock) is idempotent', async () => {
  const A = ids['System Admin'];
  const emp = (await call('GET', '/employees', ids['Recruitment Officer'])).data.employees[0];
  const payload = { eventId: 'EVT-TEST-1', eventType: 'staff.release.initiated', employeeId: emp.employee_id, lastWorkingDay: '2099-05-31', exitType: 'Resignation' };
  const first = await call('POST', '/integrations/simulate', A, { system: 'MiHCM', payload });
  assert.equal(first.status, 200);
  assert.match(first.data.ref, /^EX\//);
  const second = await call('POST', '/integrations/simulate', A, { system: 'MiHCM', payload });
  assert.equal(second.data.duplicate, true);
});

test('data persists after a restart', async () => {
  const before_ = db.get('SELECT COUNT(*) AS n FROM exit_interviews').n;
  db.closeDb();
  await db.openDb();
  assert.equal(db.get('SELECT COUNT(*) AS n FROM exit_interviews').n, before_);
  assert.ok(db.get('SELECT 1 FROM exit_interviews WHERE ref = ?', [rel.ref]));
});
