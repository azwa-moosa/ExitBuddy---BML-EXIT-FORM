// Renders ANY questionnaire version (types: single, multi, rating, stars,
// choice, short, long; conditional questions via showIf).
import { StarsInput } from './ui.jsx';
import { fillCompany } from '../lib/format.js';
import { useApp } from '../lib/context.jsx';

export function isShown(q, a) {
  if (q.active === false) return false;
  if (!q.showIf?.length) return true;
  return q.showIf.some(c => { const v = a[c.code]; return Array.isArray(v) ? v.some(x => c.anyOf.includes(x)) : c.anyOf.includes(v); });
}
const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
export const missingRequired = (qs, a) => qs.filter(q => isShown(q, a) && q.required && empty(a[q.code])).map(q => q.code);
export const visibleCount = (qs, a) => { const vis = qs.filter(q => isShown(q, a)); return { total: vis.length, answered: vis.filter(q => !empty(a[q.code])).length }; };

export default function Questions({ questions, answers, onChange, errors = [] }) {
  const { config } = useApp();
  const set = (k, v) => onChange({ ...answers, [k]: v });
  let n = 0;
  return questions.filter(q => isShown(q, answers)).map(q => {
    n++;
    const v = answers[q.code];
    const err = errors.includes(q.code);
    const id = `q-${q.code}`;
    const opts = q.options || [];
    let input = null;
    if (q.type === 'single') input = (
      <><select aria-labelledby={`${id}-l`} value={v || ''} onChange={e => set(q.code, e.target.value)}><option value="">Choose…</option>{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        {opts.find(o => o.value === v)?.help && <p className="help">{opts.find(o => o.value === v).help}</p>}</>);
    else if (q.type === 'multi') {
      const cur = v || []; const excluded = q.excludeAnswerOf ? answers[q.excludeAnswerOf] : null;
      input = <div className="pills" role="group" aria-labelledby={`${id}-l`}>{opts.map(o => {
        const on = cur.includes(o.value);
        const dis = o.value === excluded || (!on && q.max && cur.length >= q.max);
        return <label key={o.value} title={o.help || ''}><input type="checkbox" checked={on} disabled={dis} onChange={e => set(q.code, e.target.checked ? [...cur, o.value] : cur.filter(x => x !== o.value))} /><span>{o.label}</span></label>;
      })}</div>;
    } else if (q.type === 'rating') input = (
      <div className="scale" role="radiogroup" aria-labelledby={`${id}-l`}>
        {[1, 2, 3, 4, 5].map(x => <label key={x}><input type="radio" name={q.code} checked={v === x} onChange={() => set(q.code, x)} /><span>{x}<small>{config.ratingLabels[x]}</small></span></label>)}
        {q.allowPNTS && <label><input type="radio" name={q.code} checked={v === 'PNTS'} onChange={() => set(q.code, 'PNTS')} /><span style={{ fontSize: 12 }}>Prefer not<br />to say</span></label>}
      </div>);
    else if (q.type === 'stars') input = <StarsInput label={q.text} value={v || 0} onChange={x => set(q.code, x)} />;
    else if (q.type === 'choice') input = <div className="pills" role="radiogroup" aria-labelledby={`${id}-l`}>{opts.map(o => <label key={o.value}><input type="radio" name={q.code} checked={v === o.value} onChange={() => set(q.code, o.value)} /><span>{o.label}</span></label>)}</div>;
    else if (q.type === 'short') input = <input type="text" aria-labelledby={`${id}-l`} maxLength={250} value={v || ''} onChange={e => set(q.code, e.target.value)} />;
    else input = <textarea aria-labelledby={`${id}-l`} maxLength={4000} value={v || ''} onChange={e => set(q.code, e.target.value)} placeholder="Please share your thoughts…" />;
    return (
      <div className={`q ${err ? 'has-error' : ''}`} key={q.code} id={id}>
        <span className="qn">{n}</span>
        <div><div className="qt" id={`${id}-l`}>{fillCompany(q.text, config.companyName)}{q.required && <span className="req" aria-hidden="true">*</span>}</div>{input}
          {err && <p className="tiny" style={{ color: 'var(--red-ink)', marginTop: 6 }}>This question is required.</p>}</div>
      </div>
    );
  });
}

export function AnswerView({ questions, answers }) {
  const { config } = useApp();
  let n = 0;
  return (
    <div className="tablewrap"><table><tbody>
      {questions.filter(q => isShown(q, answers) || answers[q.code] != null).map(q => {
        n++;
        const v = answers[q.code];
        const opt = x => (q.options || []).find(o => o.value === x)?.label || x;
        let out;
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) out = <span className="muted">No answer</span>;
        else if (q.type === 'multi') out = <span className="row" style={{ gap: 4 }}>{v.map(x => <span key={x} className="chip">{opt(x)}</span>)}</span>;
        else if (q.type === 'single' || q.type === 'choice') out = opt(v);
        else if (q.type === 'rating' || q.type === 'stars') out = v === 'PNTS' ? <span className="muted">Prefer not to say</span> : <><b>{v}</b> / 5 <span className="muted small">{config.ratingLabels[v]}</span></>;
        else out = <span style={{ whiteSpace: 'pre-wrap' }}>{v}</span>;
        return <tr key={q.code}><td style={{ width: '46%' }} className="muted small">{n}. {fillCompany(q.text, config.companyName)}{q.active === false && <span className="chip" style={{ marginLeft: 6 }}>retired</span>}</td><td>{out}</td></tr>;
      })}
    </tbody></table></div>
  );
}
