# ExitBuddy — BML Exit Interview & Staff Release

**Version 5.0.0** · People & Culture · Employee Relations
Repository: <https://github.com/azwa-moosa/bml-exit-form>

> **Fictional data only.** Everything in the demo database is invented. The repository contains no real staff records, passwords, API keys or corporate configuration.

---

## Contents
1. [What ExitBuddy does](#1-what-exitbuddy-does)
2. [The workflow](#2-the-workflow)
3. [What changed in 5.0](#3-what-changed-in-50)
4. [Install and run](#4-install-and-run)
5. [Commands](#5-commands)
6. [Users and role switching](#6-users-and-role-switching)
7. [Testing the full flow locally](#7-testing-the-full-flow-locally)
8. [Database and migrations](#8-database-and-migrations)
9. [Digital acknowledgement records](#9-digital-acknowledgement-records)
10. [Roles and permissions](#10-roles-and-permissions)
11. [Microsoft 365 / Entra ID authentication (production)](#11-microsoft-365--entra-id-authentication-production)
12. [MiHCM and OneUI / ESS integration](#12-mihcm-and-oneui--ess-integration)
13. [Microsoft Teams notifications and calendar](#13-microsoft-teams-notifications-and-calendar)
14. [Environment variables and API](#14-environment-variables-and-api)
15. [Security and privacy](#15-security-and-privacy)
16. [Deployment](#16-deployment)
17. [Implemented vs. pending](#17-implemented-vs-pending)

---

## 1. What ExitBuddy does
ExitBuddy has five functions:

| # | Function | Who |
|---|---|---|
| 1 | **Staff Release** — initiate the employee's release and issue the form link | Recruitment Officer |
| 2 | **Exit Interview Form** — the original ExitBuddy questions (Q1–Q9), then *How do we reach out to you?* | Employee |
| 3 | **ER Meeting** — schedule the **mandatory** exit interview meeting and manage its participants | ER officer |
| 4 | **Meeting Remarks** — one text box for the meeting record | ER officer |
| 5 | **Complete Exit** — the ER officer completes the exit directly (no assessment, no approval) | ER officer |

Supporting features: digital acknowledgements in place of signatures, automatic date/time stamps, append-only audit history, mock Microsoft Teams notifications, simple dashboards and reports.

## 2. The workflow
```
Exit initiated → Employee completes exit form → ER meeting scheduled → ER meeting conducted → Meeting remarks → Complete Exit
(Recruitment)    (acknowledge + ExitBuddy Q1–Q9)  (participants added)   (marked by ER)          (one text box)   (ER officer)
```

| Internal status | Shown as | Next action |
|---|---|---|
| Released | Awaiting acknowledgement | Employee acknowledges (reminder after N days) |
| Acknowledged / Form in progress | Acknowledged / Form in progress | Employee submits the form |
| Submitted | Form submitted | ER schedules the meeting (overdue after N days) |
| Meeting scheduled | ER meeting scheduled | ER marks it conducted, or records a no-show / cancels |
| Interviewed | ER meeting conducted | ER records Meeting Remarks, then **Complete Exit** |
| Closed | **Exit completed** | — (can be reopened with a reason) |
| No response / Withdrawn | No response / Release withdrawn | Paper form can still be entered / link stops working |

Rules that are **not configurable**:
- The ER meeting is **mandatory**. Employees are never asked whether they want one.
- **Complete Exit** is allowed only when the form is submitted **and** a meeting is marked conducted **and** its Meeting Remarks are recorded. The server enforces this (`POST /api/cases/:id/complete`).
- A **no-show** or **cancelled** meeting is recorded and kept, but never completes the exit; ER schedules a new meeting.
- There is **no ER Manager approval** and **no ER assessment** step.

Internal status keys (`Closed`, `Interviewed`, `closed_at`) and the event key `case.closed` are unchanged so existing records and integrations keep working; the UI shows "Exit completed", "Exit completion date", etc.

## 3. What changed in 5.0
| Area | Change |
|---|---|
| Questionnaire | **Only the original ExitBuddy questions** (Q1–Q9, same wording, choices, order and required flags). The 21-question combined form, version selection and the questionnaire editor are removed. Admins see a read-only *Exit Interview Questions* page. |
| Employee form | Grade, date of joining and length of service removed. Compact read-only details at the top; **How do we reach out to you?** moved to the end. *Submission Status* merged into *My Release* with collapsible panels. |
| ER meeting | Mandatory. Participants: employee + responsible ER officer (required) plus users from the configured list or people added by name (optional email). Participants can be changed before the meeting. Automatic meeting reference (`EX/2026/0001/M1`). |
| Meeting minutes | Replaced by **one Meeting Remarks** text box. Recorder, date, time and audit entry are captured automatically. |
| Completion | "Close case / Closure" → **Complete Exit / Exit completed**. ER Manager approval, closure requests and the approval queue are removed. |
| Removed | ER Assessment (Regrettable / Non-regrettable), Rehire (eligibility, pool, analytics), Problem Areas (RAG, league table, trends, spike alerts), AI Insights / external LLM, manager-risk and tenure indicators, headcount / exit-rate settings, the v2 importer. |
| Navigation | Release Status / Pending Acknowledgements / Pending Cases / Interview Records pages became filters on *Staff Releases* and *Exit Cases*. |

Historical data is **kept**: old minutes are merged into Meeting Remarks, old classification / rehire values stay in their columns (not shown), answers to the retired 21-question form stay readable on those records, and all history rows remain.

## 4. Install and run
Requirements: **Node.js 20.19+** (22 LTS recommended) and VS Code. No Docker, no database server — SQLite runs inside the app (sql.js).

```bash
cd ~/Downloads/bml-exit-form
cp .env.example .env        # first time only
npm install
npm run dev
```
Open **<http://localhost:5173>**. The API runs on port 4000 (Vite forwards `/api`). An empty database is loaded with fictional demo data automatically; an existing database is **upgraded in place** on start-up (section 8).

In VS Code: *File → Open Folder…* → `bml-exit-form` → *Terminal → New Terminal* → `npm run dev`. If a port is busy: `lsof -ti:4000 | xargs kill` (or `:5173`).

## 5. Commands
| Command | What it does |
|---|---|
| `npm run dev` | API + frontend with auto-reload |
| `npm test` | Automated server tests (15) |
| `npm run seed` | Wipe the local database and reload demo data |
| `npm run migrate` | Apply database migrations only |
| `npm run build` | Build the frontend into `client/dist` |
| `npm start` | Serve the built app and API on <http://localhost:4000> |

## 6. Users and role switching
Local development has **no login**: use the **switcher in the header**. Each action is checked against the role's permissions on the server and recorded as *Simulated*.

| Name | Role | Access |
|---|---|---|
| Aminath Azwa Moosa | System Admin | Full access |
| Fathimath Rayya Hilmy | ER Manager | Case work, oversight dashboards, reports, audit. **No approval step.** |
| Aishath Ish-ha Loreef | Lead ER Officer | Default responsible ER officer; meetings, remarks, Complete Exit |
| Fathimath Shaiha Ahmed Ziyaf | ER Head — **view only** | Status, analytics, reports; cannot change anything |
| Mohamed Maiz | Director of People and Culture — **view only** | Executive dashboard, analytics, reports; no operational editing |
| Recruitment Officer (Demo) | Recruitment Officer | Initiates releases; never sees answers |
| Auditor (Demo) | Auditor | Audit trail and status-only records |
| Employee — *(fictional names)* | Employee | Own release only |

Roles without any create/edit/delete permission are labelled *(view only)* in the switcher. The switcher is refused in production (`NODE_ENV=production` will not start with `AUTH_MODE=dev`). Employees can also use their personal link `/exit/<code>`.

> The brief spelled the Director's name "Moahmed Maiz"; the app uses **Mohamed Maiz**. Change it in *Users & Roles* if the brief's spelling is correct.

## 7. Testing the full flow locally
1. Switch to **Recruitment Officer (Demo)** → *Initiate Release* → select an employee → confirm → copy or open the link.
2. Switch to **Employee — (that name)** (bottom of the switcher) → *Acknowledgement* → *Exit Interview Form*. Check that only Q1–Q9 appear, no Grade / DOJ / length of service, and *How do we reach out to you?* is last. Submit.
3. Switch to **Aishath Ish-ha Loreef — Lead ER Officer** → *Exit Cases* → *Meeting to schedule* → open the case.
4. **Schedule ER meeting** → add participants (search a user, or type a name and *Add*) → Schedule. Use **Edit** to change participants before the meeting.
5. **Mark conducted** → write **Meeting Remarks** → *Save remarks*.
6. **Complete Exit** (the checklist above it shows what is missing until then).
7. Switch to **ER Manager**, **ER Head** and **Director** to compare access. Check that Problem Areas, AI Insights and rehire are gone.
8. *Notification Centre → All notifications* (System Admin) shows the simulated Teams messages; *Audit Trail* shows every step with timestamps.

## 8. Database and migrations
- SQLite file `server/data/exit.sqlite` (git-ignored). Times are stored in UTC and shown in Maldives time (MVT).
- Migrations run automatically at start-up and are recorded in `schema_migrations`:
  - `001_v3_baseline`, `002_release_management` — earlier versions.
  - **`003_simplified_workflow`** (this release):
    - ExitBuddy (v1) becomes the only active questionnaire; other versions are *retired* (kept for old answers); unsubmitted forms move to ExitBuddy and their old-format drafts are cleared.
    - `meetings` gets `ref`, `remarks`, `conducted_at`, `conducted_by`; old minutes (discussion / matters raised / next steps) are merged into `remarks`.
    - New table `meeting_participants` (additional participants; the employee and ER officer are implicit and always included).
    - Cases waiting for closure approval return to their real status, with a workflow event explaining why.
    - The `approvals` and `ai` permissions, RAG / spike / manager-risk / headcount / AI settings and the closure-request, regrettable and spike notification rules are removed. Meeting rules also notify participants; completion also notifies the employee.
    - **No history rows are deleted.** Old columns (`classification`, `rehire`, `grade`, `date_joined`, `discussion`, …) and the `ai_runs` table are left in place.
- `audit_log`, `workflow_events` and `acknowledgements` are append-only (database triggers).
- Back up by copying `exit.sqlite` while the app is stopped. Reset demo data: *Application Settings → Reset demo data* (dev only) or `npm run seed`.

## 9. Digital acknowledgement records
Each confirmation (release initiated / acknowledged, form submitted, ER meeting conducted / no-show, meeting remarks recorded, exit completed) creates a record with **name · employee or user ID · role · action · date · time (server) · status · reference · comment · source**. They appear on the case, the employee's page, the printed record (instead of signature lines) and the audit trail. They are system records, **not** formal electronic signatures unless Legal / Compliance approves that use.

## 10. Roles and permissions
Default permissions (C create · V view · E edit · D delete; changeable in *Permissions*, enforced on every API route):

| Area | Admin | ER Manager | Lead ER Officer | ER Head | Director | Recruitment | Auditor |
|---|---|---|---|---|---|---|---|
| Staff releases | CVED | V | V | V | — | CVED | — |
| Exit cases (E = assign, Complete Exit) | CVED | CVED | CVE | V | — | — | V |
| Confidential responses | V | V | V | — | — | — | — |
| ER meetings & remarks | CVED | CVED | CVE | — | — | — | — |
| Confidential ER notes | CVED | CVED | CVE | — | — | — | — |
| Analytics | V | V | — | V | V | — | — |
| Reports (C = export) | CV | CV | — | V | V | — | — |
| Exit interview questions | V | V | — | — | — | — | — |
| Notification centre (all) | VE | V | — | — | — | — | — |
| Integration settings | VE | — | — | — | — | — | — |
| Audit trail | V | V | — | — | — | — | V |
| Workflow & app settings | VE | V | — | — | — | — | V |
| Users, roles & permissions | CVED | V | — | — | — | — | V |

Hidden tabs are a convenience only; a direct URL or API call without permission returns 403.

## 11. Microsoft 365 / Entra ID authentication (production)
**Designed, not implemented.** With `AUTH_MODE=entra` every protected call returns **401** until token validation is added — no fallback, no bypass.
1. Register the app in Entra ID (single tenant): SPA redirect URI for the frontend, an API scope such as `api://<api-client-id>/access_as_user`.
2. Frontend: MSAL (`@azure/msal-browser`) → access token → `Authorization: Bearer <token>`.
3. API: validate issuer, audience, signature (tenant JWKS) and expiry in `server/src/identity.js → identify()` (for example with `jose`).
4. Map **Entra App Roles** → app roles (`ExitApp.SystemAdmin`, `ExitApp.ERManager`, `ExitApp.ERLeadOfficer`, `ExitApp.ERHead`, `ExitApp.Director`, `ExitApp.Recruitment`, `ExitApp.Auditor`); match staff by UPN to `users.email` and employees by employee-ID claim to `employees.employee_id`.
5. Keep the existing `allow(module, op)` checks.

## 12. MiHCM and OneUI / ESS integration
**Mock only** — see `INTEGRATION_GUIDE.md` for proposed events and payloads (to be confirmed with each team; no endpoints are assumed).
- **MiHCM** (proposed source of employee data and the release decision) pushes `staff.release.initiated`; the app creates the release idempotently. Grade and date of joining are kept in the HR record for authorised integrations but are not shown in the app.
- **OneUI / ESS** can be the authoritative acknowledgement source (*Workflow Settings*); the app then waits for `staff.release.acknowledged` instead of asking the employee.
- Outbound status events (acknowledged, form submitted, exit completed — event name `exit.case.closed` kept for compatibility) are written as mock events with retry.
- Test with *Integration Settings → Simulate MiHCM release event / Simulate OneUI acknowledgement*.

## 13. Microsoft Teams notifications and calendar
**Teams notifications are simulated.** Each is stored with recipient, event, channel, status (Simulated / Failed / Pending), attempts and error; nothing is sent. Meeting participants who are configured users are notified; people added by name are listed on the meeting only. Test failures in *Notification Centre → Rules & delivery*. Going live: Microsoft Graph activity feed, a Teams bot or Workflows webhook — permissions and admin consent are not assumed.

**Microsoft 365 calendar (future):** when the ER meeting is scheduled, create an Outlook / Teams calendar event for the participants through Microsoft Graph (`POST /users/{organiser}/events`, with `isOnlineMeeting` for Teams meetings) and store the event ID on the meeting; update or cancel it when the meeting changes. This needs an app registration with `Calendars.ReadWrite` (delegated or application, with admin consent) and is **not implemented**. Implementation point: the meeting routes in `server/src/routes/cases.js`.

## 14. Environment variables and API
`.env` (copy from `.env.example`; never commit it):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 4000 | API port |
| `DB_FILE` | ./data/exit.sqlite | Database file (relative to `server/`) |
| `AUTH_MODE` | dev | `dev` = no login (local only); `entra` = production (section 11) |
| `NODE_ENV` | — | `production` refuses `AUTH_MODE=dev` |
| `ALLOWED_ORIGINS` | — | Origins for a separately hosted frontend |
| `INTEGRATION_SHARED_SECRET` | — | Key for `POST /api/integrations/inbound/:system`; empty = disabled |
| `VITE_API_BASE` *(client build)* | — | API URL when the frontend is hosted separately |

The old `LLM_*` variables are no longer used and can be deleted from your `.env`.

Main API groups (under `/api`): `session`, `config`, `dev/*`, `public/exit/:code`, `me/release`, `employees`, `releases`, `cases` (incl. `cases/:id/complete`), `meetings` (incl. `meetings/:id/conducted`, `meetings/:id/remarks`), `notes`, `staff/er`, `analytics/overview`, `reports/*`, `questionnaire`, `users`, `roles`, `settings`, `notifications`, `integrations`, `audit`, `health`.

## 15. Security and privacy
- Server-side permission checks on every route; answers, contact details, meetings and notes are split by permission, and each view of answers is audit-logged.
- Dev identities cannot run in production; `/api/dev/*` is blocked outside dev.
- Employee links are random codes, expire after the last working day + N days, stop on withdrawal and are rate-limited.
- Analytics hide divisions with fewer than *suppressBelow* forms from viewers without response access.
- No external AI or data sharing. Retention is not automated yet (decision needed).
- Before production: Entra token validation, HTTPS, CSP, penetration test, backups and encryption at rest.

## 16. Deployment
**One server:** `npm install && npm run build && NODE_ENV=production AUTH_MODE=entra npm start` on a Node host with a persistent disk for `server/data/`.
**Split:** frontend on Vercel (root `client`, `VITE_API_BASE=https://<api-host>`, SPA rewrite) and the API on a Node host with `ALLOWED_ORIGINS` set. Vercel serverless functions are not suitable (SQLite needs a persistent file).

## 17. Implemented vs. pending
| Implemented and tested | Pending / mock |
|---|---|
| Release → acknowledgement → ExitBuddy form → mandatory ER meeting with participants → conducted → Meeting Remarks → Complete Exit | Entra ID sign-in (returns 401 until built) |
| No-show / cancellation tracking that never completes an exit | Real OneUI, MiHCM, Teams and M365 calendar integrations |
| Digital records, append-only history, audit log with CSV | Automated retention / anonymisation |
| Mock notifications with retries and failure alerts | Legal sign-off for digital records as signatures |
| Role switcher; server-enforced permissions for all 7 roles | Production hosting, backups, HTTPS, CSP |
| In-place upgrade of existing databases (migration 003) | |

Verification for this release: 15 automated server tests (`npm test`), the production build, and an automated browser run of the full 16-step flow plus every page for all 7 roles and an employee (34 checks).
