# Changelog

## UI restyle — Employee Relations Desk design language
Presentation layer only; no workflow, permission, data or API changes.
- Typography: Inter Variable (UI), Plus Jakarta Sans Variable (headings), JetBrains Mono Variable (reference numbers and identifiers), self-hosted via @fontsource-variable (no Google Fonts request).
- One centralised token system in `client/src/styles.css` (light + dark, Settings → Branding alias kept), ERD colours, 6/10/14/18/22 radii, ERD shadows.
- Layered surfaces (off-white workspace, white cards, tinted secondary/tertiary surfaces), soft rose/blue/violet accents, restrained brand gradient on existing hero banners.
- Charts use theme-aware CSS variables. Printed documents are unchanged.

## 5.0.0 — 26 Oct 2026
ExitBuddy simplified to five functions: Staff Release → Exit Interview Form → ER Meeting → Meeting Remarks → Complete Exit.

- Questionnaire: only the original ExitBuddy questions (Q1–Q9). The 21-question combined form, version selection, the questionnaire editor and the v2 importer are removed; a read-only *Exit Interview Questions* page remains.
- Employee form: Grade, date of joining and length of service removed; compact details strip; *How do we reach out to you?* is the last section; submission status merged into *My Release*.
- ER meeting is mandatory (no opt-out question, no setting). Participants: employee + ER officer (required) plus configured users or people added by name; editable before the meeting. Automatic meeting reference.
- One *Meeting Remarks* text box replaces the minutes fields; recorder, date, time and audit captured automatically.
- *Complete Exit* replaces closure; allowed only after the form, a conducted meeting and remarks. No-show / cancellation tracked but never completes. ER Manager approval removed.
- Removed: ER Assessment (classification), rehire, Problem Areas (RAG, league table, trends, spike alerts), AI Insights / LLM, manager-risk, tenure and headcount analytics.
- Navigation: Release Status, Pending Acknowledgements, Pending Cases and Interview Records folded into filters. Collapsible panels for answers, notes, records and history.
- Migration `003_simplified_workflow` upgrades existing databases in place without deleting history.

## 4.0.0 — 25 Oct 2026
v2 (`bml-exit-interviews`) and v3 (`bml-exit-form`) merged into one Exit Interview & Staff Release Management application, built on the v3 codebase.

- No login in local development: header user/role switcher with the five named P&C users, plus Recruitment and Auditor demo personas and fictional employees. Refused in production. `AUTH_MODE=entra` prepared (returns 401 until Entra validation is built).
- Release-first workflow: Recruitment initiates (mock HRIS) → EX reference + employee link → acknowledgement → form → ER meetings, minutes, notes, tagging → closure request → ER Manager approval → closed. Withdraw / correct / remind; no-response and overdue handling.
- Versioned questionnaires (v1 ExitBuddy Q1–Q9, v2 Combined 21 = proposed default) with a draft / edit / publish / retire editor.
- Digital acknowledgement records replace signature lines; append-only audit log, workflow history and records.
- Mock Teams notifications with rules, retries, failures and a Notification Centre.
- Mock OneUI / MiHCM integration events with an inbound endpoint, simulation, idempotency and retry.
- Analytics fixes: missing ratings excluded, n shown, insufficient-data flags, small-group suppression, single division and reason lists, configurable thresholds. AI split into statistical, rule-based and optional LLM output.
- Role dashboards (admin, ER, executive, recruitment, audit); unified sidebar UI; dark mode; mobile layout.
- SQLite migrations (v3 databases upgrade in place); v2 importer (`npm run import:v2`).
- Removed: login pages, the "staff confirmed minutes" tick, hard deletes of records.

## 3.0.0
Standalone v3 (React + Vite, Node + Express + SQLite).
