# Surveys, rules and alerts

The survey engine is where most of Mio's product value and most of its
regulatory risk sit ([ADR-0009](../adr/0009-iec-62304-shaped-development.md)).
The design package widened it substantially
([ADR-0011](../adr/0011-absorb-design-package-scope.md)): conditional logic,
typed validation, trend rules across responses, and configurable outcomes.
Canvas references: `Mio Survey Builder.dc.html` (B1–B7), `Mio Patient
v2.dc.html` (P3/P4/P12), `Mio Clinician v2.dc.html` (C7).

## Versioning

```
survey
  └── survey_version          draft │ published │ archived
        ├── locale_variant    en │ fi │ sv (per-language completeness tracked)
        ├── question tree     pages → questions → nested follow-ups
        └── rule_set          single-response + trend rules, template defaults
```

Rules that do not bend:

- **A published version is immutable.** Any edit — wording, logic, validation,
  rules — creates a new version (B4, B5 state this explicitly in the UI).
- **A response binds to `survey_version_id`**, plus the locale answered in,
  plus a hash of the rendered question set.
- Attaching to a treatment defaults to the newest published version; an older
  published version is selectable (T4).
- Surveys ↔ treatments are many-to-many; the catalog shows usage ("3
  programs") and bound response counts per version.

## Multilingual surveys

Both authoring styles are supported: one survey with language variants (one
version, several `locale_variant` rows — same question identity, comparable
across languages), or separate surveys per language for genuinely different
instruments. The builder tracks per-language completeness ("SV* — 3 questions
untranslated", B1/B4); a variant with gaps is not offered to patients in that
language. Survey content is **data**, not UI strings — it never goes through
react-intl. Assignment language follows the patient's preference by default
("Finnish — patient's choice", T4).

**Licensed instruments.** The catalog includes *Quality of life (QLQ-30)* —
the EORTC QLQ-C30, a licensed, validated instrument whose translations are
EORTC-controlled. Using it requires an agreement and forbids re-translating or
restructuring it in the builder. Register item R11; the catalog carries a
licensing-provenance note per survey so a validated instrument is
distinguishable from a house-built one.

## The question tree

Question types follow familiar form-builder conventions (choice single/multi,
scale, number, date, free text) plus the **body map**. Two structural features
from the design:

### Conditional logic (B5)

Follow-up questions appear based on answers, and **branches nest as deep as
needed** (2 → 2a → 2b). Conditions attach per answer option, and may also
reference another question's answer. Semantics that must hold identically in
the renderer and on the server:

- A question is *visible* iff its condition chain is satisfied; skipped
  branches do not count against progress (P4's "2 of 8" counts visible
  questions only).
- *Required* applies only to visible questions. A hidden question's stale
  answer is discarded on submit — it must not linger to fire rules.
- Each follow-up carries its own validation and its own rules.
- The definition forms a tree; cycles are impossible by construction in the
  builder and rejected by schema validation on the server.

This is the strongest case for the shared TypeScript survey package
([ADR-0003](../adr/0003-typescript-node-backend.md)): visibility, progress,
validation and rule evaluation are one implementation used by the renderer,
the builder preview and the server.

### Input validation (B6)

Per question: answer type (text / number / date), and for numbers a range,
decimal precision and display unit. Advanced: an **authored regex** with an
**authored error message** ("Give the temperature like 38.5"), checked on top
of type and range. The client validates for UX; the server is authoritative.

> **Regex is authored content executed on the request path — treat it as a
> denial-of-service surface.** Patterns are validated at authoring time
> against a linear-time-safe subset (no backreferences, no nested unbounded
> quantifiers), length-capped, and evaluated with a linear-time engine (RE2 or
> equivalent) — never the backtracking JS engine on raw author input. The
> builder rejects what the runtime would.

## The body map (B3, P4, C7)

An SVG human figure, front and back, with individually selectable regions at
head / trunk / limb / muscle-group granularity (chest, neck, abdomen, upper and
lower back, shoulders, upper arms, forearms, hands, pelvis & groin, buttocks,
thighs, lower legs, feet — sided L/R where applicable).

- The **template** marks regions critical (⚑ chest, neck in the canvas); a
  **program** may override the critical set when the survey is attached.
- Rules: critical-area marked → severity; any-other-area → severity; count
  threshold ("3 or more areas") → severity.
- **The patient never sees severities or critical areas — only the map.**
- Every region keeps an optional SNOMED CT body-structure code.
- Accessibility: pointer, keyboard and assistive tech are first-class on the
  same component — a parallel, properly labelled control-group representation
  of the same regions, same state. The selection summary is text ("2 areas
  selected — chest, left forearm"), so the interaction is confirmable without
  the picture.

## Rules: conditions → outcomes

One declarative rule model, one deterministic evaluator, one trace format —
for everything the system does in reaction to clinical input. **Declarative
JSON, never authored code**; the only authored executable-adjacent content is
the validation regex above, constrained as described.

### Conditions

| Kind | Example from the canvases |
|---|---|
| Single response | answer is "2 times or more"; fever ≥ 38.0; critical body-map area marked; 3+ areas marked |
| Trend across consecutive responses | "Once" for 2 surveys in a row; fatigue ≥ Moderate for 3 in a row; weight decreases 3 in a row |
| Missed response | no response for 2 consecutive occurrences |

Trend windows are defined over **consecutive occurrences of the same survey in
the same program**, evaluated against the version-bound history; the trace
records exactly which prior responses were read.

### Outcomes — each optional, in any combination (B7)

- **Raise an alert** with severity High / Moderate / Low.
- **Send a custom notification** — recipients: treatment team, a role
  (treatment lead, care coordinator), and/or the patient — with
  clinician-authored text, delivered *as written* to the dashboard queue, the
  activity log, and (if patient is chosen) the patient's Updates.
- **Create a task**, unclaimed in the team queue ("Call patient").
- **Record only** — with all outcomes off, the pattern is stored and visible
  in trends, and nothing is raised.

Custom-notification text is clinical content: it exists in-app only. The email
layer stays type-and-deeplink ([structural guarantee 3](overview.md)) — an
email may say something is waiting, never what.

### Program-specific rule layering

Template rules are defaults. Attaching a survey to a treatment program may
override thresholds, expected ranges and critical body-map areas — "what
counts as expected vs. alarming can be adjusted per treatment program" (B2),
and the same answers behave differently in another program (PP3). The
**effective rule set** for evaluation is template rules + program overrides,
both versioned; the response detail (C7) shows each answer against the
program's rules ("Above expected" / "Expected in this program" / "Critical
area") plus the program's rule summary. Editing overrides is Treatment Lead
capability (`treatment.configure_program_rules`), the same regulated-adjacent
tier as template rule authoring.

### Evaluation and the trace

Evaluation runs server-side: on submission, and — via the worker over
materialised occurrences ([`scheduling.md`](scheduling.md)) — when a due date
passes unanswered. Same inputs, same effective rule set ⇒ same outcomes,
always. The builder previews with the same shared implementation.

Every fired rule stores **why**: the answers (or absence) read, the prior
responses a trend condition consumed, the condition, the threshold, which
layer (template or program override) supplied it, the rule and survey
versions, and every outcome produced. Clinicians ask "why did this fire?"; if
MDR lands Class IIa, this trace is the evidence the software behaves as
specified. A **trigger** is a single fired rule; an alert aggregates one or
more triggers and cites them ("Triggers: nausea 'severe', vomiting '2 times or
more', skin change on a critical area" — C7).

## Alert workflow

```
new ──► acknowledged ──► resolved
```

Severity-graded, assignable, commentable, fully audited — the alert detail
(PP6) shows the audited history timeline (raised by rule → acknowledged and
assigned → comments → resolved, each with who and when) and links the source
response or self-report. Alerts surface in the dashboard triage queue with
severity and state, and on the patient summary.

Patients do not see alerts, severities or triggers. What they get is designed
(P12): a calm, plain-language note on submission ("Because nausea has
increased, your care team takes a closer look. They may contact you today"),
and any patient-addressed custom notification a rule author wrote. Clinical
sign-off tracked as P4 in the register.

## Responding (patient)

- One question per step, progress over *visible* questions, save-and-resume
  drafts, Save & exit.
- Due dates, reminders, an unambiguous overdue state, and an answer window per
  assignment ([`scheduling.md`](scheduling.md)).
- A standing escape hatch on symptom surveys: "Feeling very unwell right now?
  Call the clinic."
- Clinicians may fill on behalf of a patient; provenance is recorded on the
  response and rendered everywhere it appears ("Dr Koskinen, on behalf" —
  PP4).
- Non-response is a signal: overdue surveys sit in the worklist, and missed
  occurrences run the missed-response rules.

## Trends and review

- **Per patient:** response detail (C7) with per-answer standing; "Compare
  over time" across occurrences; the completed-surveys list color-codes each
  response's outcome (severity / no triggers) and always opens the **whole**
  response bound to its exact version (PP4).
- **Aggregate:** per-program response rates and open-alert metrics on the
  reporting screen — median time-to-acknowledge for high severity is the
  canvas's headline operational metric (A4).
- Cross-version comparison must be honest: where wording changed between
  versions, the UI says so rather than silently plotting a discontinuity.
- Survey answers can also feed the patient's symptom register and value series
  ([`observations.md`](observations.md)) — the symptom mapping versions with
  the survey; the value binding is an open decision (register P7).
