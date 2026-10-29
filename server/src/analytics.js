// ============================================================================
// Exit interview analytics for the dashboards and reports.
// Rules (configurable in Application Settings):
//  - Missing ratings are left out — never counted as 0.
//  - Every average carries n; averages from fewer than `minResponses` answers
//    are flagged "insufficient data".
//  - Viewers without access to confidential responses get small groups
//    (< `suppressBelow` forms) hidden; anyone can switch privacy mode on.
//  - One controlled division list and one reason-category list.
// ============================================================================
import { REASON_CATEGORIES, FACTORS } from './config/questionnaires.js';
import { normalize } from './services/normalize.js';

const num = v => typeof v === 'number' && Number.isFinite(v);
export const mean = a => { const v = a.filter(num); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const round = (v, d = 2) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
const monthKey = d => String(d || '').slice(0, 7);
export function lastMonths(n, end = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(end.getFullYear(), end.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  return out;
}

// rows: parsed exit_interviews. Adds `n` (normalised answers) to submitted ones.
export function prepare(rows, f = {}) {
  const inRange = r => (!f.from || r.last_day >= f.from) && (!f.to || r.last_day <= f.to) && (!f.division || r.division === f.division) && (!f.department || r.department === f.department);
  const scoped = rows.filter(r => !r.withdrawn_at && inRange(r));
  const submitted = scoped.filter(r => r.submitted_at).map(r => ({ ...r, n: normalize(r) }));
  return { scoped, submitted };
}

function factorTable(rows, s) {
  return FACTORS.map(f => {
    const v = rows.map(r => r.n.factors[f]).filter(num);
    return { factor: f, avg: round(mean(v)), n: v.length, insufficient: v.length < s.minResponses };
  }).filter(x => x.n > 0).sort((a, b) => a.avg - b.avg);
}

export function overview({ scoped, submitted }, s) {
  const rows = submitted;
  const ratings = rows.map(r => r.n.overall).filter(num);
  const primary = {}, any = {};
  rows.forEach(r => {
    if (r.n.primary) primary[r.n.primary] = (primary[r.n.primary] || 0) + 1;
    r.n.reasons.forEach(c => { any[c] = (any[c] || 0) + 1; });
  });
  const reasons = REASON_CATEGORIES.map(c => ({ reason: c, primary: primary[c] || 0, count: any[c] || 0 })).filter(x => x.count).sort((a, b) => b.count - a.count || b.primary - a.primary);
  // "Would you return or refer someone here?" (ExitBuddy Q8) — a survey answer, not a rehire decision.
  const rr = { both: 0, ret: 0, ref: 0, neither: 0, unsure: 0, n: 0 };
  rows.forEach(r => {
    const a = r.n.wouldReturn, b = r.n.wouldRefer;
    if (a == null && b == null) return;
    rr.n++;
    if (a === true && b === true) rr.both++; else if (a === true) rr.ret++; else if (b === true) rr.ref++; else if (a === false && b === false) rr.neither++; else rr.unsure++;
  });
  const byDiv = {};
  scoped.forEach(r => { byDiv[r.division] = byDiv[r.division] || { exits: 0, forms: 0, ratings: [] }; byDiv[r.division].exits++; });
  rows.forEach(r => { byDiv[r.division].forms++; if (num(r.n.overall)) byDiv[r.division].ratings.push(r.n.overall); });
  const divisions = Object.entries(byDiv).map(([division, x]) => ({ division, exits: x.exits, forms: x.forms, avg: round(mean(x.ratings)), n: x.ratings.length, insufficient: x.ratings.length < s.minResponses }))
    .sort((a, b) => b.exits - a.exits || a.division.localeCompare(b.division));
  const months = lastMonths(12);
  const isOpen = r => !r.closed_at && !['No response', 'Withdrawn'].includes(r.status);
  return {
    exits: scoped.length, forms: rows.length,
    pending: scoped.filter(r => !r.submitted_at && isOpen(r)).length,
    completed: scoped.filter(r => r.closed_at).length,
    inProgress: scoped.filter(r => r.submitted_at && isOpen(r)).length,
    responseRate: scoped.length ? Math.round((rows.length / scoped.length) * 100) : null,
    avgRating: round(mean(ratings)), ratingN: ratings.length, ratingInsufficient: ratings.length < s.minResponses,
    topReason: reasons[0] || null,
    returnOrRefer: rr.n ? Math.round(((rr.both + rr.ret + rr.ref) / rr.n) * 100) : null,
    reasons, divisions, factors: factorTable(rows, s),
    monthly: months.map(m => ({ month: m, exits: scoped.filter(r => monthKey(r.last_day) === m).length })),
    returnRefer: rr,
  };
}
