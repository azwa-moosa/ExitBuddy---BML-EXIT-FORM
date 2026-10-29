// ============================================================================
// OneUI / MiHCM integration — MOCK services.
// No live system is called. Events are written to integration_events so the
// Integration Settings page shows what would be exchanged.
//   inbound   MiHCM/OneUI → this app   staff.release.initiated, staff.release.acknowledged
//   outbound  this app → OneUI/MiHCM   release.acknowledgement.status, exit.form.status, exit.case.closed
// Payload shapes are PROPOSED (INTEGRATION_GUIDE.md) and must be confirmed
// with the MiHCM / OneUI teams. No endpoint URLs are assumed.
// ============================================================================
import { get, run, getSettings, utcNow } from '../db.js';
import { notify } from './notify.js';

function deliverOutbound(id) {
  const s = getSettings();
  const ev = get('SELECT * FROM integration_events WHERE id = ?', [id]);
  if (s.integrations?.simulateFailure) {
    run(`UPDATE integration_events SET status = 'Failed', attempts = attempts + 1, last_error = 'Simulated failure: endpoint not reachable (mock)' WHERE id = ?`, [id]);
    notify('integration.failed', null, { ref: ev.ref, system: ev.system, eventType: ev.event_type, error: 'Simulated failure (mock)' });
    return false;
  }
  run(`UPDATE integration_events SET status = 'Simulated', attempts = attempts + 1, last_error = NULL, processed_at = ? WHERE id = ?`, [utcNow(), id]);
  return true;
}

// Queue a status update back to OneUI (when enabled). Returns the event id.
export function outbound(eventType, r, payload = {}, at = null) {
  const s = getSettings();
  const cfg = s.integrations?.oneui || {};
  if (cfg.mode === 'disabled' || cfg.syncAcknowledgement === false) return null;
  const body = { eventType, reference: r.ref, employeeId: r.employee_uid, externalReleaseId: r.external_id || null, occurredAt: at || utcNow(), ...payload };
  const { id } = run(`INSERT INTO integration_events (at, direction, system, event_type, ref, payload, status) VALUES (COALESCE(?, datetime('now')), 'outbound', 'OneUI', ?, ?, ?, 'Pending')`,
    [at, eventType, r.ref, JSON.stringify(body)]);
  deliverOutbound(id);
  return id;
}

export function retryIntegration(id) {
  const ev = get('SELECT * FROM integration_events WHERE id = ?', [id]);
  if (!ev || ev.status !== 'Failed' || ev.direction !== 'outbound') return false;
  return deliverOutbound(id);
}

// Record an inbound event; returns { duplicate, id }.
export function recordInbound(system, eventType, externalId, payload, status, error = null, ref = null) {
  if (externalId) {
    const dup = get(`SELECT id, status, ref FROM integration_events WHERE system = ? AND direction = 'inbound' AND external_id = ?`, [system, externalId]);
    if (dup) return { duplicate: true, id: dup.id, ref: dup.ref, status: dup.status };
  }
  const { id } = run(`INSERT INTO integration_events (direction, system, event_type, external_id, ref, payload, status, last_error, processed_at) VALUES ('inbound',?,?,?,?,?,?,?,datetime('now'))`,
    [system, eventType, externalId || null, ref, JSON.stringify(payload), status, error]);
  if (status === 'Rejected') notify('integration.failed', null, { ref, system, eventType, error });
  return { duplicate: false, id };
}
export const setInboundRef = (id, ref, status) => run('UPDATE integration_events SET ref = ?, status = ? WHERE id = ?', [ref, status, id]);
