// Exit interview analytics and reports. Viewers WITHOUT access to confidential
// responses always get small groups suppressed and never see comments.
import { Router } from 'express';
import { all, getSettings, audit } from '../db.js';
import { allow, actorOf, can } from '../identity.js';
import { parseCase, STATUS_LABEL } from '../services/workflow.js';
import { overview, prepare } from '../analytics.js';
import { h, str, filtersOf, bad } from './util.js';

export const insightsRouter = Router();
const rows = () => all('SELECT * FROM exit_interviews').map(parseCase);
const suppressFor = (req) => !can(req.user, 'responses', 'r') || req.query.privacy === '1' || req.body?.privacy === true;

// Overview with small divisions hidden when privacy applies.
function overviewFor(req) {
  const s = getSettings(); const out = overview(prepare(rows(), filtersOf(req.query)), s);
  const privacy = suppressFor(req);
  const suppressed = privacy ? out.divisions.filter(d => d.forms < s.suppressBelow).map(d => d.division) : [];
  return { ...out, divisions: out.divisions.filter(d => !suppressed.includes(d.division)), suppressedDivisions: suppressed, privacy, suppressBelow: s.suppressBelow };
}

insightsRouter.get('/analytics/overview', allow('analytics', 'r'), h((req, res) => res.json(overviewFor(req))));

insightsRouter.get('/analytics/departments', allow('analytics', 'r'), h((req, res) => {
  const d = str(req.query.division, 80);
  res.json({ departments: all(`SELECT DISTINCT department FROM exit_interviews WHERE department IS NOT NULL ${d ? 'AND division = ?' : ''} ORDER BY department`, d ? [d] : []).map(r => r.department) });
}));

// ---------------------------------------------------------------- reports
insightsRouter.get('/reports/summary', allow('reports', 'r'), h((req, res) => {
  const f = filtersOf(req.query);
  audit(actorOf(req), 'reports', 'View', null, `Exit summary report viewed${f.division ? ` (${f.division})` : ''}`);
  res.json({ filters: f, generatedAt: new Date().toISOString(), overview: overviewFor(req) });
}));

const csv = rowsOut => rowsOut.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
const sendCsv = (res, name, out) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv(out));
};
insightsRouter.get('/reports/divisions.csv', allow('reports', 'c'), h((req, res) => {
  const ov = overviewFor(req);
  const out = [['Division', 'Exits', 'Forms submitted', 'Average overall rating', 'n (ratings)', 'Insufficient data']];
  ov.divisions.forEach(d => out.push([d.division, d.exits, d.forms, d.avg, d.n, d.insufficient ? 'Yes' : 'No']));
  if (ov.suppressedDivisions.length) out.push([`${ov.suppressedDivisions.length} division(s) suppressed: fewer than ${ov.suppressBelow} forms`]);
  audit(actorOf(req), 'reports', 'Export', null, `Division report exported (${ov.divisions.length} rows)`);
  sendCsv(res, 'exit-division-report', out);
}));
insightsRouter.get('/reports/cases.csv', allow('reports', 'c'), h((req, res) => {
  if (!can(req.user, 'cases', 'r')) return bad(res, 'Your role cannot export individual cases.', 403);
  const f = filtersOf(req.query);
  const list = rows().filter(r => (!f.division || r.division === f.division) && (!f.from || r.last_day >= f.from) && (!f.to || r.last_day <= f.to));
  const out = [['Reference', 'Status', 'Employee ID', 'Name', 'Division', 'Department', 'Last working day', 'Released', 'Acknowledged', 'Form submitted', 'Exit completion date']];
  list.forEach(r => out.push([r.ref, STATUS_LABEL[r.status] || r.status, r.employee_uid, r.name, r.division, r.department, r.last_day, r.released_at, r.acknowledged_at, r.submitted_at, r.closed_at]));
  audit(actorOf(req), 'reports', 'Export', null, `Case list exported (${list.length} rows, no responses)`);
  sendCsv(res, 'exit-cases', out);
}));
