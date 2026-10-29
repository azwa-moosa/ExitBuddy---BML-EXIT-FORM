// Exit interview analytics and reports (data-quality rules: missing ratings
// excluded, n shown, insufficient data flagged, small groups suppressed for
// viewers without response access).
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import Filters, { useFilters } from '../../components/Filters.jsx';
import { Empty, ErrorBox, Fold, Kpi, Loading } from '../../components/ui.jsx';
import { printReport } from '../../components/Print.jsx';
import { api, apiUrl, qs } from '../../lib/api.js';
import { useApp } from '../../lib/context.jsx';
import { monthLabel, monthYear, ratingClass } from '../../lib/format.js';

const REASON_COLOURS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const TONE = { red: 'var(--red)', amber: 'var(--amber)', green: 'var(--green)', none: 'var(--grey)' };
const axis = () => ({ fontSize: 11, fill: 'var(--muted)' });
const TIP = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', color: 'var(--fg)', fontSize: 12.5 }, labelStyle: { color: 'var(--muted)', fontWeight: 600 }, itemStyle: { color: 'var(--fg)' } };
const fmtAvg = (v, d = 2) => v == null ? '—' : v.toFixed(d);

function useData(path, f) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const load = () => { setErr(null); api(`${path}${qs({ ...f, privacy: f.privacy ? '1' : '' })}`).then(setD).catch(e => setErr(e.message)); };
  useEffect(load, [path, JSON.stringify(f)]); // eslint-disable-line react-hooks/exhaustive-deps
  return [d, err, load];
}
const PrivacyNote = ({ d, config }) => d.privacy ? <div className="banner info small" style={{ marginBottom: 14 }}><Icon name="lock" size={16} />Privacy mode: divisions with fewer than {config.suppressBelow} forms are hidden{d.suppressedDivisions?.length ? ` (${d.suppressedDivisions.length} hidden)` : ''}.</div> : null;

export function Overview() {
  const { config, can } = useApp();
  const [f, setF] = useFilters();
  const [d, err, load] = useData('/analytics/overview', f);
  if (err) return <main><ErrorBox error={err} retry={load} /></main>;
  if (!d) return <main><Loading /></main>;
  const rr = d.returnRefer; const c = 'var(--chart-1)';
  const maxReason = Math.max(1, ...d.reasons.map(r => r.count));
  return (
    <main>
      <div className="page-head"><div><h1>Analytics</h1><p>ExitBuddy exit interview results. Missing ratings are excluded, never counted as zero.</p></div></div>
      <Filters value={f} onChange={setF} privacyLocked={!can('responses', 'r')} />
      <PrivacyNote d={d} config={config} />
      <div className="grid g4">
        <Kpi icon="users" tone={1} value={d.exits} label="Exits" sub={`${d.forms} forms${d.responseRate != null ? ` · ${d.responseRate}% response` : ''} · ${d.pending} pending`} />
        <Kpi icon="check" tone={4} value={d.completed} label="Exits completed" sub={`${d.inProgress} with the ER team`} />
        <Kpi icon="star" tone={2} value={fmtAvg(d.avgRating)} label="Avg. overall rating" sub={d.ratingN ? `out of 5 · n = ${d.ratingN}${d.ratingInsufficient ? ' · insufficient data' : ''}` : 'no ratings yet'} />
        <Kpi icon="trend" tone={3} textual value={d.topReason ? d.topReason.reason : '—'} label="Top reason for leaving" sub={d.topReason ? `${d.topReason.count} mentions` : ''} />
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-head"><div><h2>Reasons for leaving</h2><p>Q1 — all reasons selected</p></div></div>
          <div className="bars">
            {d.reasons.slice(0, 10).map((r, i) => (
              <div className="bar" key={r.reason}><span className="lbl">{r.reason}</span>
                <span className="trk"><i style={{ width: `${(r.count / maxReason) * 100}%`, background: REASON_COLOURS[i % REASON_COLOURS.length] }} /></span>
                <span className="val">{r.count}</span></div>))}
            {!d.reasons.length && <p className="muted">No reasons yet.</p>}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div><h2>Experience factors</h2><p>Q3–Q6 converted to a 1–5 score</p></div></div>
          <div className="bars">
            {d.factors.map(x => (
              <div className="bar" key={x.factor} style={{ gridTemplateColumns: 'minmax(140px, 34%) minmax(0, 1fr) 120px' }}>
                <span className="lbl">{x.factor}</span><span className="trk"><i style={{ width: `${(x.avg / 5) * 100}%`, background: TONE[ratingClass(x.avg)] }} /></span>
                <span className="val">{fmtAvg(x.avg)} <span className="tiny muted">n = {x.n}{x.insufficient ? ' · low n' : ''}</span></span>
              </div>))}
            {!d.factors.length && <p className="muted">No factor ratings yet.</p>}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h2>Would you return or refer someone here?</h2><p>Q8 — the employee’s answer ({rr.n} responses)</p></div></div>
        <div className="grid g4">
          {[['Both yes', rr.both, 'green'], ['Would return only', rr.ret, 'sky'], ['Would refer only', rr.ref, 'violet'], ['Neither', rr.neither, 'red']].map(([l, v, tone]) => (
            <div key={l} className="card flat" style={{ textAlign: 'center', padding: 12 }}><b style={{ fontSize: 22 }}>{rr.n ? Math.round((v / rr.n) * 100) : 0}%</b><div className="small"><span className={`chip ${tone}`}>{l}</span></div><div className="tiny muted">{v} response{v === 1 ? '' : 's'}</div></div>))}
        </div>
      </section>

      <div className="stack" style={{ gap: 8, marginTop: 16 }}>
        <Fold title="Exits by division" sub={`${d.divisions.length} divisions`}>
          {d.divisions.length ? <div style={{ height: 300 }}><ResponsiveContainer>
            <BarChart data={d.divisions} margin={{ top: 8, right: 8, left: -20, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="division" angle={-35} textAnchor="end" interval={0} tick={axis()} />
              <YAxis allowDecimals={false} tick={axis()} />
              <Tooltip {...TIP} cursor={{ fill: 'var(--surface-2)' }} />
              <Bar dataKey="exits" name="Exits" fill={c} radius={[6, 6, 0, 0]} />
              <Bar dataKey="forms" name="Forms" fill="var(--chart-1)" fillOpacity={0.3} radius={[6, 6, 0, 0]} />
            </BarChart></ResponsiveContainer></div> : <Empty icon="chart">No exits in this filter.</Empty>}
        </Fold>
        <Fold title="Month-on-month exits" sub="last 12 months, by last working day">
          <div style={{ height: 230 }}><ResponsiveContainer>
            <LineChart data={d.monthly} margin={{ top: 10, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis()} /><YAxis allowDecimals={false} tick={axis()} />
              <Tooltip {...TIP} labelFormatter={monthYear} /><Line type="monotone" dataKey="exits" name="Exits" stroke={c} strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart></ResponsiveContainer></div>
        </Fold>
      </div>
    </main>
  );
}

export function Reports() {
  const { can, config, user } = useApp();
  const [f, setF] = useFilters();
  const [d, err, load] = useData('/reports/summary', f);
  const q = qs({ from: f.from, to: f.to, division: f.division, department: f.department, privacy: f.privacy ? '1' : '' });
  const o = d?.overview;
  return (
    <main>
      <div className="page-head"><div><h1>{user?.dashboard === 'executive' ? 'Executive reports' : 'Reports'}</h1><p>Printable summary and CSV exports. Every view and export is recorded in the audit trail.</p></div></div>
      <Filters value={f} onChange={setF} privacyLocked={!can('responses', 'r')} />
      {err && <ErrorBox error={err} retry={load} />}
      {!d && !err && <Loading />}
      {d && (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <section className="card stack">
            <h2>Exit summary report</h2>
            <p className="small muted">Exits, completion, ratings, reasons and divisions{o.privacy ? `; divisions under ${o.suppressBelow} forms hidden` : ''}. No names or comments.</p>
            <div className="grid g3">
              <div className="card flat"><p className="label">Exits</p><b style={{ fontSize: 22 }}>{o.exits}</b></div>
              <div className="card flat"><p className="label">Completed</p><b style={{ fontSize: 22 }}>{o.completed}</b></div>
              <div className="card flat"><p className="label">Avg rating</p><b style={{ fontSize: 22 }}>{fmtAvg(o.avgRating)}</b><div className="tiny muted">n = {o.ratingN}</div></div>
            </div>
            <div className="btns"><button className="btn primary" onClick={() => printReport(d, config, `${user.name} (${user.role})`)}><Icon name="print" size={15} />Print / Save as PDF</button></div>
          </section>
          <section className="card stack">
            <h2>Exports (CSV)</h2>
            {can('reports', 'c') ? <>
              <a className="btn" href={apiUrl(`/reports/divisions.csv${q}`)}><Icon name="download" size={15} />Division summary</a>
              {can('cases', 'r') && <a className="btn" href={apiUrl(`/reports/cases.csv${q}`)}><Icon name="download" size={15} />Case list (status only, no responses)</a>}
            </> : <p className="small muted">Your role can view reports but not export them.</p>}
          </section>
        </div>)}
    </main>
  );
}
