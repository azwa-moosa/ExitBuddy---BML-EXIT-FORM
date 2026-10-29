# Integration Guide — OneUI / ESS, MiHCM, Microsoft Teams, Entra ID

> **Status: every integration here is a MOCK or a PROPOSAL.**
> No real endpoints, credentials, tenant IDs or Microsoft permissions are configured or assumed.
> Each event name, field and URL below is a **proposal to be confirmed** with the owning team (OneUI, MiHCM / HRIS, M365 / IT, Information Security).

## 1. Overview

```
            (proposed)                                  (proposed)
 MiHCM ──staff.release.initiated──▶  ┌────────────────────────┐ ──release.acknowledgement.status──▶ OneUI / ESS
                                     │  Exit Interview & Staff │ ──exit.form.status───────────────▶
 OneUI ──staff.release.acknowledged─▶│  Release application    │ ──exit.case.closed───────────────▶
                                     │  (this app)             │
                                     └───────────┬────────────┘
                                                 │ notifications (simulated)
                                                 ▼
                                       Microsoft Teams (future: Graph / bot)
```

| Concern | Proposed source of truth |
|---|---|
| Employee master data (name, ID, grade, division, manager, joining date — grade and joining date are stored but not shown in the app) | **MiHCM** (mock HRIS table `employees` for now) |
| Decision to release, notice date, last working day | **MiHCM** (or Recruitment in this app until MiHCM integration exists) |
| Employee acknowledgement of release | **Configurable**: this app (default) **or** OneUI (Workflow Settings → Acknowledgement source) |
| Exit interview answers, ER meetings and participants, meeting remarks, ER notes, exit completion | **This app** |
| Identity and roles | **Microsoft Entra ID** |

## 2. How the mock works (testable now)
- **Integration Settings** shows each system's mode (*Mock* / *Disabled*; *Live* is greyed out until built and approved).
- Every inbound and outbound message is written to `integration_events` with direction, system, event type, external ID, reference, payload, status, attempts, last error and a *simulated* flag.
- **Simulate MiHCM release event** / **Simulate OneUI acknowledgement** run the same code as the real inbound endpoint.
- **Simulate outbound integration failures** makes outbound events fail. They appear as *Failed* with a **Retry** button, and System Admins get an *Integration error* notification.
- **Idempotency:** a unique index on `(system, direction, external_id)` means a repeated `eventId` is recorded once and then ignored (`{"duplicate": true}`). A second release for an employee who already has an open release is rejected.

## 3. Inbound endpoint (this app)
```
POST /api/integrations/inbound/:system        (:system = MiHCM | OneUI)
Header: X-Integration-Key: <INTEGRATION_SHARED_SECRET>
Content-Type: application/json
```
- Disabled (503) unless `INTEGRATION_SHARED_SECRET` is set in `.env`; a wrong key returns 401.
- The shared key is a **placeholder** for local testing. Production should use the method agreed with InfoSec, such as mutual TLS, an Entra client-credentials token validated by the API, or an API gateway.
- Responses: `201` created · `200` processed or duplicate · `400` unsupported event · `404` unknown release · `409` / `422` rejected (for example, unknown employee or open release).

### 3.1 `staff.release.initiated` (MiHCM → app), proposed
```json
{
  "eventId": "EVT-2026-000123",
  "eventType": "staff.release.initiated",
  "employeeId": "EMP-10294",
  "releaseId": "MIHCM-REL-55821",
  "exitType": "Resignation",
  "noticeDate": "2026-10-25",
  "lastWorkingDay": "2026-11-24",
  "initiatedBy": "MiHCM workflow",
  "note": "Optional note shown to the employee"
}
```
Effect: creates the release (EX reference), the employee link, the default assignee, the workflow event, the digital record and notifications. `releaseId` is stored as `external_id`.

### 3.2 `staff.release.acknowledged` (OneUI → app), proposed
```json
{
  "eventId": "EVT-ONEUI-77812",
  "eventType": "staff.release.acknowledged",
  "reference": "EX/2026/0037",
  "releaseId": "MIHCM-REL-55821",
  "acknowledgedAt": "2026-10-26T05:12:00Z"
}
```
Effect: records the acknowledgement with source **OneUI**. If the release is already acknowledged, the event is logged as *Ignored (already acknowledged)*, so there is no duplicate record. When OneUI is the acknowledgement source, the employee page tells the employee to acknowledge in OneUI instead of showing a button.

## 4. Outbound events (app → OneUI), proposed
Sent when *OneUI mode = Mock* and *Send status updates* is on. Currently they are only written to `integration_events`, and nothing leaves the server.

| Event | When | Extra fields |
|---|---|---|
| `release.acknowledgement.status` | Release acknowledged (in the app) | `status: "ACKNOWLEDGED"`, `acknowledgedAt` |
| `exit.form.status` | Exit form submitted | `status: "SUBMITTED"`, `submittedAt` |
| `exit.case.closed` | Exit completed (event name kept for compatibility) | `status: "CLOSED"`, `closedAt` |

Common body:
```json
{ "eventType": "exit.form.status", "reference": "EX/2026/0037", "employeeId": "EMP-10294",
  "externalReleaseId": "MIHCM-REL-55821", "occurredAt": "2026-10-27 09:30:00", "status": "SUBMITTED" }
```
**No answers, comments or ER notes are ever sent outbound.**

### Retry policy (proposed for live)
Exponential back-off (for example 1 min, 5 min, 30 min, 2 h), then *Failed* with an admin alert. Manual retry from Integration Settings. Receivers must be idempotent on `reference + eventType + occurredAt`.

## 5. To confirm with each team
**MiHCM / HRIS**
- Is a webhook or event feed available, or must the app poll an API? The endpoint URL, authentication and rate limits.
- Field names for employee ID, grade, division / department / unit, line manager and joining date.
- Whether MiHCM can send release corrections and withdrawals (proposed: `staff.release.updated`, `staff.release.withdrawn`; not implemented).

**OneUI / ESS**
- Whether OneUI is the authoritative place for the employee's acknowledgement.
- Whether OneUI can show the exit-form link, or host the form itself.
- Endpoint and authentication for receiving status updates.

## 6. Microsoft Teams notifications
**Now:** a mock provider. Rows in `notifications` have channel *Microsoft Teams (simulated)* and status *Simulated* / *Failed* / *Pending*. Each send is tried up to *maximum attempts* (default 3). After that it becomes *Failed*, and System Admins receive a *Notification delivery failed* alert. The app never states that a Teams message was really sent.

**Options for going live** (choose with M365 / IT; permissions are **not** assumed):
1. **Microsoft Graph activity feed notifications** to users (requires an app registration, a Teams app manifest and the relevant Graph application permission with admin consent).
2. **A Teams bot** (Azure Bot Service) sending proactive 1:1 messages.
3. **Teams Workflows / incoming webhook** to an ER channel (channel-level, for team notifications only, not for employees).

Implementation point: `server/src/services/notify.js → deliverMock()`. Add a provider for the chosen option, keep the same status / attempt / error fields, and keep employee messages free of confidential content.

## 7. Microsoft Entra ID (authentication)
See README section 12. In short: MSAL in the frontend, bearer tokens to the API, and token validation in `server/src/identity.js → identify()`. App Roles map to the app's roles (README section 13). With `AUTH_MODE=entra` and no validation implemented, the API returns 401. There is no bypass.
