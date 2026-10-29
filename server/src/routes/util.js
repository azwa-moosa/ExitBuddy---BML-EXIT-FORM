// Small helpers shared by the route files.
import { tx } from '../db.js';

export const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;
export const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const bad = (res, msg, code = 400, extra = {}) => res.status(code).json({ error: msg, ...extra });

// Wrap a handler: runs inside one transaction; RuleError → 4xx with its message.
export const h = fn => (req, res, next) => {
  try {
    const out = tx(() => fn(req, res));
    if (out && typeof out.then === 'function') out.catch(e => fail(e, res, next));
  } catch (e) { fail(e, res, next); }
};
// Async variant (no wrapping transaction; the handler opens its own).
export const ha = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(e => fail(e, res, next));

function fail(e, res, next) {
  if (e && e.status && e.status < 500) return res.status(e.status).json({ error: e.message, fields: e.fields });
  if (e && /append-only/.test(e.message)) return res.status(409).json({ error: 'History records cannot be changed.' });
  next(e);
}

export const filtersOf = q => ({
  from: isDate(q.from) ? q.from : '', to: isDate(q.to) ? q.to : '',
  division: str(q.division, 80) || '', department: str(q.department, 80) || '',
});
