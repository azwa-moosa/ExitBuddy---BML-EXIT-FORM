// Questionnaire lookup, conditional display and answer validation.
// New releases always use the ExitBuddy questionnaire (version 1); a record
// keeps the version it answered, so older answers stay readable.
import { get, run } from '../db.js';
import { EXITBUDDY } from '../config/questionnaires.js';

let cache = new Map();
export const clearQuestionnaireCache = () => { cache = new Map(); };

export function getVersion(version) {
  if (cache.has(version)) return cache.get(version);
  const r = get('SELECT * FROM questionnaires WHERE version = ?', [version]);
  if (!r) return null;
  const q = { ...r, questions: JSON.parse(r.questions || '[]') };
  cache.set(version, q);
  return q;
}
export const defaultVersion = () => EXITBUDDY.version;

// Load the ExitBuddy questionnaire the first time (seed or upgrade).
export function ensureQuestionnaires(by = 'System') {
  if (get('SELECT 1 FROM questionnaires WHERE version = ?', [EXITBUDDY.version])) return false;
  run(`INSERT INTO questionnaires (version, name, status, is_default, note, questions, created_by, published_by, published_at)
       VALUES (?,?, 'published', 1, ?, ?, ?, ?, datetime('now'))`,
    [EXITBUDDY.version, EXITBUDDY.name, EXITBUDDY.note, JSON.stringify(EXITBUDDY.questions.map((q, i) => ({ ...q, position: i + 1, active: true }))), by, by]);
  clearQuestionnaireCache();
  return true;
}

const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
export function isShown(q, answers) {
  if (q.active === false) return false;
  if (!q.showIf || !q.showIf.length) return true;
  return q.showIf.some(c => { const v = answers[c.code]; return Array.isArray(v) ? v.some(x => c.anyOf.includes(x)) : c.anyOf.includes(v); });
}

export function validateAnswers(questions, input = {}) {
  const answers = {}; const errors = [];
  for (const q of questions) {
    if (!isShown(q, { ...input, ...answers })) continue;
    let v = input[q.code];
    const values = (q.options || []).map(o => o.value);
    if (q.type === 'multi') {
      v = Array.isArray(v) ? [...new Set(v.filter(x => values.includes(x)))] : [];
      if (q.excludeAnswerOf) v = v.filter(x => x !== answers[q.excludeAnswerOf]);
      if (q.max) v = v.slice(0, q.max);
    } else if (q.type === 'single' || q.type === 'choice') v = values.includes(v) ? v : null;
    else if (q.type === 'stars') v = Number.isInteger(+v) && +v >= 1 && +v <= 5 ? +v : null;
    else if (q.type === 'rating') v = v === 'PNTS' && q.allowPNTS ? 'PNTS' : (Number.isInteger(+v) && +v >= 1 && +v <= 5 && v !== '' && v != null ? +v : null);
    else v = typeof v === 'string' ? v.trim().slice(0, q.type === 'short' ? 250 : 4000) : '';
    if (empty(v)) { if (q.required) errors.push(q.code); continue; }
    answers[q.code] = v;
  }
  return { answers, errors };
}
