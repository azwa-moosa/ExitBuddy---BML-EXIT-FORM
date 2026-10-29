// Turns an answer set into one canonical shape using each question's `metric`.
// Dashboards read only this shape, so any older answers kept in an upgraded
// database are counted with ExitBuddy answers.
import { getVersion } from './questionnaire.js';

const num = v => typeof v === 'number' && Number.isFinite(v);

export function normalize(record) {
  const qn = getVersion(record.questionnaire_version || 1);
  const a = record.answers || {};
  const out = { overall: null, primary: null, reasons: [], factors: {}, wouldReturn: null, wouldRefer: null,
    texts: { stay: '', improve: '', other: '', growth: '', reasonOther: '' } };
  if (!qn) return out;
  const cats = new Set();
  for (const q of qn.questions) {
    const v = a[q.code];
    if (v == null || v === '') continue;
    const opt = val => (q.options || []).find(o => o.value === val);
    switch (q.metric) {
      case 'overall': if (num(v)) out.overall = v; break;
      case 'reasons_primary': { const c = opt(v)?.category || v; out.primary = c; cats.add(c); break; }
      case 'reasons': (Array.isArray(v) ? v : [v]).forEach(x => cats.add(opt(x)?.category || x)); break;
      case 'factor': {
        const s = q.type === 'rating' || q.type === 'stars' ? (num(v) ? v : null) : opt(v)?.score ?? null;
        if (num(s)) out.factors[q.factor] = s;
        break;
      }
      case 'would_return': out.wouldReturn = opt(v)?.flag ?? null; break;
      case 'would_refer': out.wouldRefer = opt(v)?.flag ?? null; break;
      case 'return_refer': { const x = opt(v); if (x) { out.wouldReturn = x.ret; out.wouldRefer = x.ref; } break; }
      case 'text_stay': out.texts.stay = String(v); break;
      case 'text_improve': out.texts.improve = String(v); break;
      case 'text_other': out.texts.other = String(v); break;
      case 'text_growth': out.texts.growth = String(v); break;
      case 'reason_other': out.texts.reasonOther = String(v); break;
      default: break;
    }
  }
  // ExitBuddy has no single "main reason": the first selected reason is used.
  if (!out.primary && cats.size) out.primary = [...cats][0];
  out.reasons = [...cats];
  return out;
}
