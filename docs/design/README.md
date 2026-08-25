# Design package — analysis and status

The approved design lives in **`design/handoff-2026-08-21/`** — a Claude Design
handoff bundle committed verbatim. The canvas files (`*.dc.html`) are the
visual source of truth; these documents are the analysis that binds them to the
architecture.

The design determines the extent and structure of the application: it closes
every gap in its own gap analysis (all 56 artboards delivered) and it extends
the product beyond the brief the architecture docs were first written against.
What it adds architecturally is recorded in
[ADR-0011](../adr/0011-absorb-design-package-scope.md).

## File map (current canvases)

| File | Boards | Covers |
|---|---|---|
| `Mio Login.dc.html` | L0–L7 | Launch, sign-in (mobile+desktop), email code, first login, forgot/reset, error |
| `Mio Patient v2.dc.html` | P1–P16 | Patient app, mobile and desktop: landing, menu, surveys, body-map fill, treatments, messages, settings, calendar, notifications, submitted |
| `Mio Clinician v2.dc.html` | C1–C7 | Dashboard worklist, patient summary, response detail, roster, messages, tasks, empty/error |
| `Mio Patient Profile.dc.html` | PP1–PP6 | Patient-scoped sub-pages: programs/surveys/team, values, symptoms, completed surveys, details & export, alert detail |
| `Mio Survey Builder.dc.html` | B1–B7 | Catalog, editor with rules, body-map config, versions & languages, conditional logic, validation, trend rules, rule editor |
| `Mio Treatments.dc.html` | T1–T4 | Treatment detail, template catalog, phased recurrence dialog, assign survey |
| `Mio Admin.dc.html` | A1–A5 | Users, role matrix, audit log, reporting, teams |
| `Mio States.dc.html` | S1–S6 | Empty/error states, session timeout, terms acceptance, notification email, logo usage, loading |

Superseded explorations kept for provenance: `Mio Patient.dc.html`,
`Mio Clinician.dc.html`, `Mio Directions.dc.html` (approved-direction board).
`support.js` and `ios-frame.jsx` are design-tool runtime, not design content.
The bundle's `project/brief.md` is the **evolved brief** — it supersedes the
original on survey logic, rules, the symptom taxonomy and the patient-profile
information architecture.

## What the design establishes

- **Design language**: warm editorial — tokens, type, components in
  [`design-system.md`](design-system.md).
- **Information architecture and every screen**: mapped to modules and
  capabilities in [`screen-inventory.md`](screen-inventory.md).
- **New product surface** beyond the original brief:
  - *Values* and *Symptoms* as first-class clinical records —
    [`../architecture/observations.md`](../architecture/observations.md).
  - Conditional survey logic (nested branching), typed input validation with
    authored regex, trend rules across consecutive responses, and configurable
    rule outcomes (alert / custom notification / task / record-only) —
    [`../architecture/surveys-and-alerts.md`](../architecture/surveys-and-alerts.md).
  - Program-specific rule interpretation: the same answer can be expected in
    one program and alarming in another; body-map areas can be critical per
    program.
  - Clinician on-behalf entry flows ("Report a symptom", "Fill a survey",
    "New value"), always with provenance.
  - Clinician-initiated patient data export with a recorded reason.
- **Product-decision guidance** on questions the docs had left open — see
  "Open questions the design answers" below.

## Design ↔ specification reconciliation

Deltas between the canvases and the committed specification. Each needs a
small decision; the recommended resolution is stated. None blocks
implementation start except X1 for the affected copy.

| # | Delta | Recommendation |
|---|---|---|
| X1 | **Password minimum**: L3 copy says "at least 10 characters"; the spec ([authentication](../architecture/authentication.md)) says 12+ per NIST 800-63B. | **Resolved (owner, 2026-08-24): 12+.** Spec, validation and implemented UI copy all say 12; the canvas copy updates at the next design sync. |
| X2 | **Lockout**: L7 copy says "after 5 tries, sign-in pauses for 15 minutes"; the spec requires progressive delay precisely because a fixed per-account pause is a denial-of-service lever against clinicians. | **Resolved (owner, 2026-08-24) as recommended — and already implemented**: progressive per-account delay in the auth service, UI copy "Sign-in is paused briefly after repeated tries". |
| X3 | **Draft promise**: S2 timeout warning says "anything you're writing is saved as a draft", while the brief says clinician messaging has no drafts. | **Resolved (owner, 2026-08-24) as recommended — implemented**: the composer preserves unsent text client-side per account+thread (restored on return, cleared on send); no managed draft feature, survey drafts stay server-side. |
| X4 | **Admin audit view**: A3 sample rows include clinical fragments ("Acknowledged alert — High, nausea/vomiting"). The data model forbids clinical content in audit records and the admin path cannot read `clinical.*`. | **Resolved (owner, 2026-08-24) as recommended**: generic event descriptions (type + resource reference, subjects as initials). Binding on the A3 build (WP-28); audit rows already carry no clinical content. |
| X5 | **FI term for survey**: the user-supplied Finnish mixes *kysely* (instrument names: "…oirekysely") and *lomake* ("Täytetyt lomakkeet", "Täytä lomake"). | **Resolved (owner, 2026-08-24): *kysely* in every context.** *Lomake* in Finnish usage refers to the blank form (template), not the instrument. Glossary and the fixed nav labels updated; implemented strings were already kysely-based. |
| X6 | **Low severity**: rules offer High/Moderate/Low, but no Low chip appears on any board (High red, Moderate amber). | **Resolved (owner, 2026-08-24): design the Low chip.** Designed and implemented in the kit as the teal outline: teal border and text with dot, surface background — quieter than the tinted High/Moderate fills, read hierarchy preserved. Canvas chip to follow at next sync. |
| X7 | **Patient self-report flow**: data shows patient-originated symptom reports ("Report a symptom, self-report", PP6/PP3), but no patient-side screen offers it. | **Resolved (owner, 2026-08-24): in scope as designed — implemented.** "Report a symptom" on the patient landing: taxonomy pick, mild/moderate/severe, optional note; lands as source `self_report` with the patient's provenance and shows in PP3 like every other observation. Canvas screen to follow at next sync. |
| X8 | **Survey → values mapping**: "PSA value" series is fed both by direct entry and by the "PSA reporting" survey, but no builder board configures which numeric question feeds which series. | **Resolved (owner, 2026-08-24) as recommended — implemented**: explicit per-question `valueBinding` in the builder (series + optional measurement-date source question), evaluated visibility-aware on submit into `value_entry` in the submission's transaction. |
| X9 | **MFA cadence**: L2 places the email code inside every sign-in. Spec agrees for v1 (no trusted-device memory designed). | **Resolved (owner, 2026-08-24) as recommended**: no change; passkeys remain the fast-follow. |
| X10 | **Icon language** (owner-requested, 2026-08-23): the canvases show text-only nav and card headers — no icon system exists beyond the bell, trend arrows and the logo mark. The owner asked for icons where they aid scanning, deliberately *not* the stock-icon-library look. | Implemented as **print-registration icons**: hand-drawn stroke glyphs in `@mio/ui` (no icon dependency, ADR-0009), each carrying the logo's light circle as a tinted layer that rests misregistered low-left — like the lockup — and slides into register on hover/focus and on the current nav page (motion respects `prefers-reduced-motion`). Applied to primary nav (all three shells), the bell, and card headers. Decorative only: always `aria-hidden`, labels stay the accessible name. **Owner approved 2026-08-24 ("until further note").** |
| X11 | **A-plane deltas from the build (WP-28, 2026-08-24)**: (a) A5 team cards say "used in 18 treatments", but treatment attachment lives in `clinical.*`, which the admin plane cannot read by construction — the count has no lawful source. (b) A1 rows carry a generic "Edit"; v1 identity administration is lifecycle + credential reset (deactivate/reactivate/reset login), with no free-form identity editor. (c) A2's canvas shows a summarised capability grid; the owner-confirmed principle (roles rendered *from* the matrix) makes the build render the full generated capability table instead. | Implemented per the constraints: team cards show member count only; A1 actions are reset login / deactivate / reactivate; A2 renders every generated capability grouped by resource, ✓/· per role. Canvas updates to follow at next sync — or the owner overrules and the deltas become work items. |
| X12 | **A4 reporting shell placement** (gate P8): the canvas draws A4 inside the administration shell, but its metrics (response rates, open alerts, acknowledge times) are clinical aggregates, and `report.view` is denied to administrators by the same principle that denies them `patient_clinical_profile.view`. | **Resolved (owner, 2026-08-24): "move it" — implemented.** A4 lives in the clinician shell (nav "Reporting", `report.view`-gated), scoped to the caller's own treatments and aggregated in-database; administrators and auditors get no route to it. Canvas moves the screen at next sync. |
| X13 | **One authored text, two audiences** (surfaced by the staff notification centre, 2026-08-24): a B7 `notify` outcome carries `recipients` (patient / team / lead) but a single `notifyText`. With only the patient centre built, that was invisible; now that the team can read their copy, a rule written in patient voice ("your care team has been notified") arrives at the care team reading oddly. | **Needs an owner decision — not improvised.** Options: (a) per-recipient text in the rule schema and the B7 editor, (b) keep one text and let authors write audience-neutral copy, guided by editor hint text. (a) is the honest fix and a schema + editor change; (b) is free. Nothing is broken today: the note is delivered, attributed and readable. |
| X14 | **Login greeting** (owner-requested, 2026-08-26): L1/L4 say "Welcome back", which reads wrong the very first time a user ever arrives — and the first arrival is an invitation flow, where nobody is "back". | **Changed to the plain greeting** — "Welcome" / "Tervetuloa" / "Välkommen"; the lede ("Sign in to your care space") is unchanged. Canvas copy updates at next sync. |
| X15 | **Role model restructure** (owner, 2026-08-25): the canvases assume one role per account (member / lead / administrator), but (a) one person can legitimately be several things, and (b) "Treatment Lead" as a platform-wide role granted lead power over EVERY treatment — an information-security hazard the owner flagged. | **Decided and implemented.** An account holds a SET of roles — patient, **clinician**, **author** (authoring split out per P3), administrator, auditor — whose grants union; auditor is exclusive and admin actions are never self-targeting. Being a lead is now a position on one treatment's care team (`team_lead` scope). A1 gained the roles editor (multi-select, audited); A2 shows five roles; a clinician+administrator lands in the clinician shell with the admin areas appended to the nav. Canvases update at next sync: A1 role column/editor, A2 columns, role names in legends. |
| X16 | **Systemic visual drift from the canvases** (owner finding, 2026-08-25): comparing the running product broadly against the handoff canvases, the owner judged the build "a lot off" the target. A board-by-board spot audit (P1, P6, C1, A1, L1 rendered from the canvases vs live screenshots) confirms the pattern: the structure and information of every screen match, and the recorded X-deltas (X10 icons, X11, X12, X14, X15) are intentional — but the design's visual execution is only partially carried. Recurring gaps: serif landing greetings with date lines (P1/C1) missing; thread bubbles built as tints instead of the design's solid-teal own-messages with author-meta below and the composer's toolbar-below/round-send arrangement (P6/C4); A1 built as a card list where the canvas draws a table with role chips, text-link actions and the reset explainer; C1 missing the "All X" card links, inline acknowledge/claim actions and the My patients/Whole team control; P1 missing date tiles, labeled card links and the Start button; L-series details (Show password, top-right locale switcher). The patient boards are also drawn mobile-first while the build is desktop-first. Technical note: the canvases render as plain HTML once `support.js` is stripped, so pixel-level reconciliation can be driven board by board. | **Needs an owner direction decision — not improvised.** Options: (a) full visual reconciliation to the canvases, keeping only X-register exceptions; (b) adopt the design language's signature elements in waves (1: greetings + thread/composer skin + card action links; 2: A1 table, C1 inline actions and worklist links, P1 tiles; 3: mobile pass + L-series details). Recommendation: (b), wave-gated with screenshots per wave. |

## Open questions the design answers (pending confirmation)

- **P4 — patient visibility of alerts.** The design's position: patients never
  see severities, triggers or critical areas (B3: "the patient never sees
  severities or critical areas — only the map"). On submission they get a
  plain-language, calm note ("Because nausea has increased, your care team
  takes a closer look. They may contact you today", P12), and a rule author may
  send the patient an authored custom notification (B7). **Owner confirmed the position 2026-08-24.** Clinical sign-off
  still to be scheduled, but the product direction is settled.
- **P2 — audit log access. Decided (owner, 2026-08-24): a dedicated
  Auditor role.** The full audit log moves from administrators to a new
  auditor staff role that is "able to actually see the data" — full
  patient identities, because oversight is its purpose. The admin plane
  keeps no full-log view; A3's X4-minimised rendering becomes the
  auditor's screen with names unmasked for that role.
- **P3 — who authors surveys and rules. Decided (owner, 2026-08-24):
  keep bundled with Treatment Lead.** The capability separation already
  exists in the matrix (survey_template.*, configure_program_rules are
  their own actions), so narrowing authorship to a dedicated role later
  is a grants edit plus regeneration, not a build — nothing to regret
  now.

## Scope audit (2026-08-24) — closed

A full board-by-board and capability-by-capability sweep after WP-33
found four deltas between what the design and matrix promised and what
was reachable. All four are now built:

1. **Clinician on-behalf survey fill** — the PP "Report" group's third
   flow. The submission core is shared with the patient's own path so
   the rules fire identically; provenance (`on_behalf_by`, and
   `on_behalf_of_patient` on every derived observation and value entry)
   follows the actor. Exercises `survey_response.submit_on_behalf_of_patient`
   and `treatment.enter_on_behalf_of_patient`.
2. **PP5 assisted contact edits** — the care team corrects phone,
   address and correspondence language: exactly the field set the
   patient can change themselves in P8. Email stays out, being the
   login identity. Exercises `patient_identity.update_contact_details`.
3. **Staff notification centre** — a B7 rule's team- or lead-addressed
   custom notification is now readable by the people it names. Same
   screen and same self-slice decision as P11, with the patient the
   note concerns rendered on staff rows.
4. **A3 filters and export** — range, event and person filters over a
   bounded default window, with facet lists computed from the range
   rather than the current narrowing, and a CSV export of exactly the
   filtered view (spreadsheet-formula characters neutralised). The
   WP-29 watermarked JSONL job remains the separate bulk/ops path.

Matrix capabilities that remain deliberately granted but unexercised
(slots for later, no surface designed): `care_relationship.*`
(relationships derive from team membership via sync),
`survey_assignment.cancel`/`send_reminder` (the flows ride
`activity`-level cancel/remind), `symptom_taxonomy.view`/`manage`
(taxonomy is seeded data; no management UI), `treatment.enrol_patient`
(enrolment is treatment creation), and the staff-realm self-service
trio (`own_settings.*`, `own_data_export.*`,
`audit_log.view_own_access_history` — the shells design these menus
for patients only).

## Rhythm with the canvases

The canvases are prototypes: implementation recreates their visual output with
the production stack (React, tokens, React Aria) — it does not copy prototype
markup. When behaviour and the canvas disagree, the reconciliation table above
and the architecture docs win; when *look* is in question, the canvas wins.
Design iterations land as a new dated bundle under `design/`, and this analysis
updates with it.
