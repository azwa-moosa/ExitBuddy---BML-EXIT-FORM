// Digital acknowledgement records and workflow history (both append-only).
import { fmtDate, fmtTime, tzLabel, fmtDateTime } from '../lib/format.js';
import { Sim } from './ui.jsx';
import { useApp } from '../lib/context.jsx';

export function DigitalRecords({ records, compact, showRef }) {
  if (!records?.length) return <p className="muted small">No confirmations recorded yet.</p>;
  if (compact) return (
    <div className="stack" style={{ gap: 8 }}>
      {records.map((r, i) => (
        <div className="digital" key={r.id || i}>
          <div className="row between"><b>{r.action}</b><span className="row" style={{ gap: 6 }}><span className="chip green">{r.status}</span><Sim on={r.simulated} /></span></div>
          <div className="small" style={{ marginTop: 4 }}>
            {r.action.startsWith('Release acknowledged') || r.actor_role === 'Employee' ? 'Acknowledged by' : 'Recorded by'}: <b>{r.actor_name}</b> · {r.actor_role === 'Employee' ? 'Employee ID' : 'User ID'}: <span className="mono">{r.actor_id || '—'}</span> · {r.actor_role}
          </div>
          <div className="tiny muted">Date: {fmtDate(r.at)} · Time: {fmtTime(r.at)} {tzLabel()}{r.source && r.source !== 'app' ? ` · Source: ${r.source.toUpperCase()}` : ''}{r.comment ? ` · ${r.comment}` : ''}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="tablewrap"><table>
      <thead><tr>{showRef && <th>Reference</th>}<th>Action</th><th>By</th><th>ID</th><th>Role</th><th>Date &amp; time ({tzLabel()})</th><th>Status</th></tr></thead>
      <tbody>{records.map((r, i) => (
        <tr key={r.id || i}>{showRef && <td className="small mono">{r.ref}</td>}<td><b>{r.action}</b>{r.comment && <div className="tiny muted">{r.comment}</div>}</td><td>{r.actor_name}</td><td className="mono">{r.actor_id || '—'}</td><td className="small">{r.actor_role}</td>
          <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.at, false)}</td><td><span className="chip green">{r.status}</span> <Sim on={r.simulated} /></td></tr>
      ))}</tbody>
    </table></div>
  );
}

const EVENT = {
  'release.initiated': 'Release initiated', 'release.corrected': 'Release corrected', 'release.withdrawn': 'Release withdrawn', 'release.acknowledged': 'Release acknowledged',
  'release.reminder': 'Reminder sent', 'form.started': 'Form started', 'form.submitted': 'Form submitted', 'meeting.scheduled': 'ER meeting scheduled', 'meeting.changed': 'ER meeting rescheduled',
  'meeting.participants': 'Participants updated', 'meeting.cancelled': 'ER meeting cancelled', 'meeting.no_show': 'ER meeting no-show', 'meeting.held': 'ER meeting conducted',
  'meeting.remarks': 'Meeting remarks recorded', 'meeting.deleted': 'Meeting deleted', 'case.assigned': 'Case assigned', 'case.closed': 'Exit completed', 'case.reopened': 'Exit reopened',
  no_response: 'No response', 'note.added': 'Note added', 'note.edited': 'Note edited', 'note.deleted': 'Note deleted', 'record.generated': 'Record generated', 'record.migrated': 'Migrated record',
  // historical events from earlier versions (kept readable)
  'case.classified': 'Classification (earlier version)', 'case.rehire': 'Rehire (earlier version)', 'case.closure_requested': 'Closure requested (earlier version)',
  'case.closure_returned': 'Closure returned (earlier version)', 'record.imported': 'Imported record', 'import.v2_history': 'Imported history',
};
export const eventLabel = e => EVENT[e] || e;

export function History({ events }) {
  const statusLabels = useApp()?.config?.statusLabels;
  if (!events?.length) return <p className="muted small">No history yet.</p>;
  return (
    <ul className="timeline">
      {[...events].reverse().map((e, i) => (
        <li key={e.id || i}>
          <b>{eventLabel(e.event)}</b>{e.to_status && e.to_status !== e.from_status && <span className="tiny muted"> → {statusLabels?.[e.to_status] || e.to_status}</span>}
          {e.detail && <div className="small">{e.detail}</div>}
          <div className="tiny muted">{fmtDateTime(e.at)} · {e.actor_name}{e.actor_role ? ` (${e.actor_role})` : ''}{e.simulated ? ' · simulated' : ''}</div>
        </li>
      ))}
    </ul>
  );
}
