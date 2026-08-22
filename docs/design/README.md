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
| X1 | **Password minimum**: L3 copy says "at least 10 characters"; the spec ([authentication](../architecture/authentication.md)) says 12+ per NIST 800-63B. | Keep 12 in the spec; update design copy. Weakening the spec to match mock copy is the wrong direction on a health system. |
| X2 | **Lockout**: L7 copy says "after 5 tries, sign-in pauses for 15 minutes"; the spec requires progressive delay precisely because a fixed per-account pause is a denial-of-service lever against clinicians. | Implement progressive delay per account+source as specified; soften the user-facing copy to "sign-in pauses briefly after repeated tries". |
| X3 | **Draft promise**: S2 timeout warning says "anything you're writing is saved as a draft", while the brief says clinician messaging has no drafts. | Read "no drafts" as *no managed draft feature*. Unsent composer text (patient and clinician) is preserved client-side per account across the timeout; survey drafts remain server-side as specified. |
| X4 | **Admin audit view**: A3 sample rows include clinical fragments ("Acknowledged alert — High, nausea/vomiting"). The data model forbids clinical content in audit records and the admin path cannot read `clinical.*`. | Audit event descriptions stay generic (event type + resource reference; subjects as initials, as A3 already shows). Design adjusts the sample copy. |
| X5 | **FI term for survey**: the user-supplied Finnish mixes *kysely* (instrument names: "…oirekysely") and *lomake* ("Täytetyt lomakkeet", "Täytä lomake"). | Owner decision needed; glossary flags both. Working assumption: *kysely* for the concept and instrument names, *lomake* acceptable inside fixed nav labels pending review. |
| X6 | **Low severity**: rules offer High/Moderate/Low, but no Low chip appears on any board (High red, Moderate amber). | Design to supply the Low chip (teal-tinted outline suggested); no engineering impact. |
| X7 | **Patient self-report flow**: data shows patient-originated symptom reports ("Report a symptom, self-report", PP6/PP3), but no patient-side screen offers it. | Design gap — either add the patient flow or descope self-report to v1.1 and keep on-behalf entry only. Tracked as P6 in the register. |
| X8 | **Survey → values mapping**: "PSA value" series is fed both by direct entry and by the "PSA reporting" survey, but no builder board configures which numeric question feeds which series. | Mechanism decision needed — tracked as P7 in the register. Recommended: an explicit per-question "writes to value series" binding in the builder. |
| X9 | **MFA cadence**: L2 places the email code inside every sign-in. Spec agrees for v1 (no trusted-device memory designed). | No change; note passkeys remain the fast-follow. |

## Open questions the design answers (pending confirmation)

- **P4 — patient visibility of alerts.** The design's position: patients never
  see severities, triggers or critical areas (B3: "the patient never sees
  severities or critical areas — only the map"). On submission they get a
  plain-language, calm note ("Because nausea has increased, your care team
  takes a closer look. They may contact you today", P12), and a rule author may
  send the patient an authored custom notification (B7). Clinical sign-off
  still required, but the direction is set.
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
