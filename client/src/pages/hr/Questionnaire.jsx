// Exit Interview Questions — the original ExitBuddy questionnaire, read-only.
// The wording, answer choices, required flags and order are fixed; there are
// no other versions to choose from.
import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import Questions from '../../components/Questions.jsx';
import { ErrorBox, Loading } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { fillCompany } from '../../lib/format.js';

const TYPE_LABEL = { multi: 'Select all that apply', stars: 'Stars 1–5', choice: 'One choice', short: 'Short text', long: 'Long text' };

export default function QuestionnaireView() {
  const { config } = useApp();
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [preview, setPreview] = useState(false); const [a, setA] = useState({});
  useEffect(() => { api('/questionnaire').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <main><ErrorBox error={err} /></main>;
  if (!d) return <main><Loading /></main>;
  const q = d.questionnaire;
  let n = 0;
  return (
    <main style={{ maxWidth: 900 }}>
      <div className="page-head"><div><h1>Exit interview questions</h1><p>{q.name} · {q.questions.length} questions ({q.questions.filter(x => x.showIf?.length).length} shown only for certain answers) · {d.responses} forms submitted</p></div>
        <button className="btn" onClick={() => setPreview(!preview)}><Icon name="eye" size={15} />{preview ? 'Show list' : 'Preview as employee'}</button></div>
      <div className="banner info small" style={{ marginBottom: 14 }}><Icon name="lock" size={16} />These are the original ExitBuddy questions. They are the only questions used and are not edited in the app. Contact details (“How do we reach out to you?”) are asked at the end of the form.</div>
      {preview ? <section className="card"><Questions questions={q.questions} answers={a} onChange={setA} /></section> : (
        <div className="stack" style={{ gap: 8 }}>
          {q.questions.map(x => {
            const sub = !!x.showIf?.length; if (!sub) n++;
            return (
              <div key={x.code} className="qrow" style={sub ? { marginLeft: 38 } : null}>
                <span className="qnum">{sub ? '↳' : n}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b className="small">{fillCompany(x.text, config.companyName)}</b>{x.required && <span style={{ color: 'var(--red)' }}> *</span>}
                  <div className="tiny muted">{TYPE_LABEL[x.type] || x.type}{x.options ? ` · ${x.options.map(o => o.label).join(' · ')}` : ''}{sub ? ` · shown when ${x.showIf.map(c => c.anyOf.join(' / ')).join(' or ')}` : ''}</div>
                </div>
              </div>
            );
          })}
        </div>)}
    </main>
  );
}
