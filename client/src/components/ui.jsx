import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { STATUS_TONE } from '../lib/format.js';
import { useApp } from '../lib/context.jsx';

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Kpi({ icon, tone = 1, value, label, sub, textual }) {
  return (
    <div className={`card kpi t-${tone}`}>
      <span className={`kpi-ic ic-${tone}`}><Icon name={icon} size={20} /></span>
      <div style={{ minWidth: 0 }}><b className={textual ? 'textual' : ''}>{value}</b><span>{label}</span>{sub && <em>{sub}</em>}</div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const { config } = useApp();
  return <span className={`chip dot ${STATUS_TONE[status] || ''}`}>{config?.statusLabels?.[status] || status}</span>;
}

export const Sim = ({ on }) => on ? <span className="chip sim" title="Recorded in local development by a simulated identity">Simulated</span> : null;

export function Empty({ icon = 'file', children }) {
  return <div className="empty"><Icon name={icon} size={34} /><div>{children}</div></div>;
}
export const Loading = ({ rows = 3 }) => <div className="stack" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}</div>;
export const ErrorBox = ({ error, retry }) => <div className="banner danger" role="alert"><Icon name="alert" /><div><b>Something went wrong.</b> {error}{retry && <> <button className="btn sm" onClick={retry}>Try again</button></>}</div></div>;
export const Lock = ({ children }) => <div className="lock"><Icon name="lock" />{children}</div>;

export function usePaged(rows, size = 15) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { if (page > pages) setPage(1); }, [pages, page]);
  const slice = useMemo(() => rows.slice((page - 1) * size, page * size), [rows, page, size]);
  return { slice, page, pages, setPage, total: rows.length };
}
export function Pager({ page, pages, setPage, total }) {
  if (pages <= 1) return <div className="pager">{total} item{total === 1 ? '' : 's'}</div>;
  return (
    <div className="pager">
      <span>{total} items · page {page} of {pages}</span>
      <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><Icon name="back" size={14} /></button>
      <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><Icon name="right" size={14} /></button>
    </div>
  );
}

// Collapsible panel (progressive disclosure). Uses <details>, so it works
// without JavaScript state and is keyboard accessible.
export function Fold({ title, sub, open, children, right }) {
  return (
    <details className="fold" open={open}>
      <summary><Icon name="right" size={14} /><span className="fold-t"><b>{title}</b>{sub != null && <span className="tiny muted">{sub}</span>}</span>{right}</summary>
      <div className="fold-b">{children}</div>
    </details>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function StarsInput({ value, onChange, label }) {
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map(n => (
        <button type="button" key={n} role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={value >= n ? 'on' : ''} onClick={() => onChange(n)}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
        </button>
      ))}
    </div>
  );
}
export const StarsStatic = ({ value }) => <span className="stars-static" aria-label={`${value ?? 0} out of 5`}>{[1, 2, 3, 4, 5].map(n => <span key={n} className={value >= n ? '' : 'off'}>★</span>)}</span>;

export function copyText(t, toast) {
  return navigator.clipboard.writeText(t).then(() => toast('Copied to clipboard')).catch(() => toast('Copy failed — select and copy the text', 'error'));
}
