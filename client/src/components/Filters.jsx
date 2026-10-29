import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/context.jsx';

const KEY = 'exit-filters-v4';
const BLANK = { from: '', to: '', division: '', department: '', privacy: false };
export function useFilters() {
  const [f, setF] = useState(() => { try { return { ...BLANK, ...JSON.parse(sessionStorage.getItem(KEY)) }; } catch { return BLANK; } });
  const set = next => { setF(next); try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  return [f, set];
}

export default function Filters({ value, onChange, privacyLocked }) {
  const { config } = useApp();
  const [depts, setDepts] = useState([]);
  useEffect(() => { api(`/analytics/departments${qs({ division: value.division })}`).then(d => setDepts(d.departments)).catch(() => {}); }, [value.division]);
  const set = (k, v) => onChange({ ...value, [k]: v, ...(k === 'division' ? { department: '' } : {}) });
  return (
    <div className="card flat" style={{ marginBottom: 16 }}>
      <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <label className="field">From<input type="date" value={value.from} onChange={e => set('from', e.target.value)} /></label>
        <label className="field">To<input type="date" value={value.to} onChange={e => set('to', e.target.value)} /></label>
        <label className="field">Division<select value={value.division} onChange={e => set('division', e.target.value)}><option value="">All divisions</option>{config.divisions.map(d => <option key={d}>{d}</option>)}</select></label>
        <label className="field">Department<select value={value.department} onChange={e => set('department', e.target.value)}><option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}</select></label>
        <label className="switch" style={{ alignSelf: 'end', paddingBottom: 10 }} title={privacyLocked ? 'Always on for your role' : ''}>
          <input type="checkbox" checked={privacyLocked || value.privacy} disabled={privacyLocked} onChange={e => set('privacy', e.target.checked)} />Hide groups under {config.suppressBelow}
        </label>
      </div>
    </div>
  );
}
