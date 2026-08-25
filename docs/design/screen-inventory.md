# Screen inventory

Every current artboard mapped to module, route and the capabilities it
exercises. Routes are the working sketch for TanStack Router; capability ids
reference [`../authz/capability-matrix.yaml`](../authz/capability-matrix.yaml).

## Application shells

Three shells, matching the three account contexts:

| Shell | Nav (top, centered) | Notes |
|---|---|---|
| Patient | Home, Messages, Treatments, Surveys, Calendar — bell + avatar; mobile menu adds Notifications, Settings, Help & contact, language, sign out | Mobile-first |
| Clinician | Dashboard, Patients, Messages, Surveys, Treatments, Tasks — avatar | Desktop-first |
| Administration | Users, Teams, Roles, Audit log, Reporting, under a "mio Administration" masthead | Separate shell, served by the no-clinical-grant path ([ADR-0007](../adr/0007-separate-identity-from-clinical-data.md)) |

Patient-scoped clinician pages (C2, PP1–PP6) add a left sub-navigation with
three groups — **Patient profile** (Patient summary, Programs, surveys & care
team, Patient details), **Health data** (Values, Symptoms, Completed
surveys, Data export), **Report** (Report a symptom, Fill a survey, New
value). Group headers are labels, not links.

## Login — `Mio Login.dc.html`

| Board | Route | Notes / capabilities |
|---|---|---|
| L0 Launch | `/` | Breathing-logo splash while the session resolves |
| L1 Sign in (mobile) | `/login` | Pre-auth language switcher EN/FI/SV; invitation hint |
| L2 Verify code | `/login/verify` | 6-digit email OTP, masked address ("ann•••nen@…"), resend timer |
| L3 First login | `/welcome/:token` | From invitation: set password (policy checklist), terms+privacy acceptance in-line |
| L4 Sign in (desktop) | `/login` | Same column, lockup + slogan panel |
| L5 Forgot password | `/login/forgot` | Enumeration-safe by spec |
| L6 Reset link sent | `/login/forgot/sent` | Link valid 60 minutes — matches spec TTL |
| L7 Sign in error | `/login` | Inline error; lockout copy pending reconciliation X2 |

## Patient app — `Mio Patient v2.dc.html`

| Board | Route | Notes / capabilities |
|---|---|---|
| P1/P7 Landing (mobile/desktop) | `/home` | Action needed, Messages, Updates, Upcoming widgets |
| P2 Menu | — | Mobile nav drawer, unread badges, language, sign out |
| P3/P13 Surveys | `/surveys` | Open (due/overdue/draft-resume) + Completed; `survey_response.save_draft`, `submit` |
| P4 Survey fill | `/surveys/:id/fill` | One question per step, progress, Save & exit, body map, clinic escape hatch |
| P12 Survey submitted | `/surveys/:id/done` | Answer summary + plain-language "closer look" note (see P4 in the register) |
| P5/P15 Treatments | `/treatments` | Quick-view expand: team, next activity, recent; inactive hidden behind filter |
| P6/P14 Messages thread | `/messages/:threadId` | Rich text B/I, image attach; expectation copy; `message_thread.post` |
| P10 Messages list | `/messages` | One thread per program; ended programs read-only |
| P9/P16 Calendar | `/calendar` | Consolidated activities + survey due dates across programs |
| P11 Notifications | `/notifications` | In-app center; read state; explains contentless emails |
| P8 Settings | `/settings` | Contact info, per-type email toggles, language/format prefs, privacy: Download my data, **Who has viewed my records** (`audit_log.view_own_access_history`) |

## Clinician app — `Mio Clinician v2.dc.html`

| Board | Route | Notes / capabilities |
|---|---|---|
| C1 Dashboard | `/dashboard` | Alert triage (severity, ack state), unread messages, overdue surveys + send reminder, my tasks incl. claim, today & upcoming; My patients / Whole team toggle |
| C3 Patient roster | `/patients` | Search name/ID; columns: treatments, alerts, surveys, next activity; sorted by open alerts then next activity |
| C2 Patient summary | `/patients/:id` | Header card (age, program, next activity) + open alert, values trio, completed & open surveys, survey management, latest activity w/ audit trail link |
| C7 Survey response detail | `/patients/:id/responses/:responseId` | Answers rendered **against program rules** ("Above expected" / "Expected in this program" / "Critical area"), body map with per-area criticality, program rule summary, alert actions + comments, Compare over time |
| C4 Messages | `/messages` | Team-shared inbox per program; **Reply vs Internal note** composer toggle; alert cross-reference in thread |
| C5 Tasks | `/tasks` | My/Unclaimed/Whole team; claim, assign; grouped Overdue/Today/This week; completed tasks land in treatment activity log |
| C6 Empty & error states | — | Panel-level variants of dashboard components |

## Patient profile sub-pages — `Mio Patient Profile.dc.html`

| Board | Route | Notes / capabilities |
|---|---|---|
| PP1 Programs, surveys & care team | `/patients/:id/programs` | Programs w/ template provenance; assigned surveys w/ schedules; team incl. **attached teams** ("shared inbox access"); membership changes audited |
| PP2 Values | `/patients/:id/values` | Series tabs (PSA, Testosterone, PSA reporting), 12-month chart, all-records table with provenance ("on behalf of patient") |
| PP3 Symptoms | `/patients/:id/symptoms` | Taxonomy-wide register: latest, trend arrows, source (survey vs self-report), program-rule context line |
| PP4 Completed surveys | `/patients/:id/responses` | Color-coded outcome (alert severity / no triggers); filters; "View whole" opens C7 |
| PP5 Patient details & export | `/patients/:id/details` | Assisted edits (audited); export: scope, PDF / machine-readable, **reason recorded** |
| PP6 Alert detail | `/alerts/:id` | Severity + state, assignee, linked response, audited history timeline, comments, reassign / resolve |

## Survey builder — `Mio Survey Builder.dc.html`

| Board | Route | Notes / capabilities |
|---|---|---|
| B1 Catalog | `/surveys` (clinician) | Status/version/languages/used-in; SV* = incomplete translation |
| B2 Editor | `/surveys/:id/edit` | Pages + questions outline, question editor, per-question alert rules, program-override note; autosave |
| B3 Body map config | `/surveys/:id/edit` | Area set (head, trunk, limbs, muscle-group level, L/R, front/back); template-critical areas ⚑; count rules ("3+ areas → High"); patient never sees criticality |
| B4 Versions & languages | `/surveys/:id/versions` | Draft/published/archived chain, response counts bound per version, per-language completeness |
| B5 Conditional logic | `/surveys/:id/logic` | Nested follow-ups (2 → 2a → 2b), per-answer conditions, cross-question conditions; skipped branches excluded from progress |
| B6 Input validation | `/surveys/:id/edit` | Type (text/number/date), range/decimals/unit, authored regex + authored error message |
| B7 Rule editor / Trend rules | `/surveys/:id/rules` | Single-response vs consecutive-surveys conditions; outcomes: alert severity, custom notification (team/role/patient + authored text), create task, record-only; missed-response rules |

## Treatments — `Mio Treatments.dc.html`

| Board | Route | Notes / capabilities |
|---|---|---|
| T1 Treatment detail | `/treatments/:id` | Lifecycle strip (draft→active→paused→completed/discontinued), activities w/ status + linked order task, attached surveys w/ reminder+escalation, team, on-behalf entry, template provenance ("modified; template updates don't change running treatments") |
| T2 Catalog | `/treatments/catalog` | Templates w/ version, attached surveys, in-use counts; instantiate copies |
| T3 Recurrence dialog | — | Once/Weekly/Monthly/**Phased** (ordered phases, "+ Add phase"), answer window, reminder, if-unanswered action, natural-language preview with next occurrence |
| T4 Assign survey | — | Survey, version (older selectable, defaults newest), language ("patient's choice"), send now/scheduled/recurring, unanswered escalation |

## Administration — `Mio Admin.dc.html`

| Board | Route | Notes / capabilities |
|---|---|---|
| A1 Users | `/admin/users` | Staff/patient tabs, create, deactivate/reactivate, **Reset login** (new setup link + session clear, audited, never data) |
| A2 Roles matrix | `/admin/roles` | Read-only capability view; "See clinical data: never" for admin — rendered from the capability matrix |
| A3 Audit log | `/admin/audit` | Filters (range, event, user), export; subjects as initials; event text generic per reconciliation X4 |
| A4 Reporting | `/admin/reporting` | Response rate 30d + delta, open alerts + oldest age, median time-to-acknowledge (high, 30d), per-program table |
| A5 Teams | `/admin/teams` | Groups of users; usage counts; attachable to treatments |

Note: A4's metrics are clinical aggregates. The canvas places reporting in the
admin shell; the capability matrix denies `report.view` to administrators.
Resolution (P8, decided 2026-08-24): the reporting screen lives in the
clinician shell for `report.view` holders. Tracked as P8 in the register.

## Cross-cutting states — `Mio States.dc.html`

| Board | Notes |
|---|---|
| S1 Empty & error | All-caught-up, no-messages, load-failure ("Nothing you've done was lost" + Try again) |
| S2 Session timeout | Warning at <2 min with countdown + "drafts are safe" (reconciliation X3); signed-out screen |
| S3 Terms acceptance | First-login, plain-language summary + full-document link, two checkboxes, version recorded |
| S4 Notification email | From `Mio <noreply@mio.health>`, subject "Something is waiting for you in Mio", zero clinical content — the structural guarantee, rendered |
| S5 Logo usage | Lockup/mark/favicon rules — in [`design-system.md`](design-system.md) |
| S6 Loading | Breathing splash + slogan |
