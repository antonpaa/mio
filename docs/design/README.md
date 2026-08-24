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

## Open questions the design answers (pending confirmation)

- **P4 — patient visibility of alerts.** The design's position: patients never
  see severities, triggers or critical areas (B3: "the patient never sees
  severities or critical areas — only the map"). On submission they get a
  plain-language, calm note ("Because nausea has increased, your care team
  takes a closer look. They may contact you today", P12), and a rule author may
  send the patient an authored custom notification (B7). **Owner confirmed the position 2026-08-24.** Clinical sign-off
  still to be scheduled, but the product direction is settled.
- **P2 — audit log access.** A3 shows administrators reading the audit log
  with subjects minimised to initials and (per X4) generic event text. The
  dedicated-auditor-role question stays open; the display posture is decided.
- **P3 — who authors surveys and rules.** A2's role matrix bundles "manage
  treatments, templates, surveys & rules" into Treatment Lead, matching the
  capability matrix's current draft. The dedicated-author question stays open
  but the default is confirmed.

## Rhythm with the canvases

The canvases are prototypes: implementation recreates their visual output with
the production stack (React, tokens, React Aria) — it does not copy prototype
markup. When behaviour and the canvas disagree, the reconciliation table above
and the architecture docs win; when *look* is in question, the canvas wins.
Design iterations land as a new dated bundle under `design/`, and this analysis
updates with it.
