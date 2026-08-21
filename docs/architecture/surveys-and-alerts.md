# Surveys and alerts

The survey engine is where most of Mio's product value and most of its
regulatory risk sit. See
[ADR-0009](../adr/0009-iec-62304-shaped-development.md).

## Versioning

```
survey
  └── survey_version          draft │ published │ archived
        ├── locale_variant    en │ fi │ sv
        └── alert_rule_set    versioned WITH the survey version
```

Rules that do not bend:

- **A published version is immutable.** Editing one creates a new version.
- **A response binds to `survey_version_id`**, plus the locale it was answered
  in, plus a hash of the rendered question set.
- When attaching a survey to a treatment, an older version may be selected;
  the newest is the default.
- Surveys ↔ treatments are many-to-many.

The response-to-version binding is cheap now and impossible to reconstruct
later. Without it, "what exactly was this patient asked in March?" has no
answer — and that question gets asked when a clinical decision is reviewed.

## Multilingual surveys

Both authoring styles from the brief are supported:

| Style | Model |
|---|---|
| One survey, several language variants | One `survey_version`, several `locale_variant` rows |
| Separate forms per language | Separate `survey` records |

The first keeps responses comparable across languages — the same question in
Finnish and Swedish is the same question, with one identity for trend analysis.
The second is for genuinely different instruments.

> Survey content is **data**, not UI strings. It does not go through react-intl
> ([ADR-0004](../adr/0004-spa-frontend-with-openapi-contract.md)). Conflating
> the two would put clinical instrument text into a translation pipeline
> designed for button labels — where an enthusiastic translator can silently
> change what a validated instrument asks.

## The builder

Question types follow familiar form-builder conventions: single and multiple
choice, scales, numeric, date, free text, matrix.

Plus **the body map**: an SVG human figure with individually selectable regions,
for marking where a patient has pain.

### Body map accessibility

The body map is the most likely place for Mio to fail WCAG 2.2 AA.

An SVG with clickable regions is unusable by keyboard and opaque to a screen
reader unless it is built with an equivalent. The requirement is a **parallel
representation**: the same regions as a keyboard-navigable, properly labelled
control group, backed by the same state. Not a fallback for "accessibility
mode" — the same component, in which pointer, keyboard and assistive technology
are all first-class.

Each region carries an optional coded identifier (SNOMED CT body structure).
Near-zero cost now; it is what makes the data interoperable if Mio ever gains
integrations.

## Alert rules

Alert rules are configured in the builder and versioned with the survey version.

**Declarative JSON, never executable code.** No user-supplied JavaScript, no
expression `eval`. A rule is conditions over question references, operators, and
optional scoring — sums or subscales — mapped to severity bands.

```
questions ──► conditions ──► score ──► severity band ──► alert
```

Evaluation is **deterministic** and happens server-side on submission. The same
inputs and the same rule version always produce the same alert. The builder
previews using the same evaluation code as the server — one implementation,
which is a principal reason for TypeScript on both sides
([ADR-0003](../adr/0003-typescript-node-backend.md)).

### The evaluation trace

Every alert stores **why it fired**: which answers, which conditions matched,
which score, which threshold, which rule version, which survey version.

This is not optional and it is not a debugging feature. Clinicians will ask
"why did this fire?" and the answer must be exact rather than reconstructed. If
MDR classification comes back Class IIa, this trace is a substantial part of the
evidence that the software behaves as specified.

`alert.view_evaluation_trace` is a distinct capability in the matrix.

### Non-response is a signal

A survey that is not answered is itself clinically meaningful. Overdue surveys
appear in the clinician worklist, and escalation on non-response is configurable
on the assignment — it is not merely a reminder email.

## Alert workflow

```
new ──► acknowledged ──► resolved
```

Assignable, commentable, severity-graded, fully audited. Patients do not see
alerts — an open question in the capability matrix, flagged there as needing a
clinical rather than an engineering answer.

## Responding

- Paging with a progress bar.
- **Save and resume drafts** — patients are unwell and on phones; a survey lost
  to a dropped connection is a survey not answered.
- Due dates, reminders, and an unambiguous overdue state.
- Clinicians may submit on behalf of a patient. This records provenance on the
  response and renders as "entered by X on behalf of patient". A response
  entered by a clinician must never be indistinguishable from one the patient
  gave.

## Trends

The same survey answered repeatedly yields a trend, per patient and in
aggregate. Trend views bind to the survey identity rather than the version, so
comparison must account for version differences — a question whose wording
changed between versions is not straightforwardly comparable, and the UI should
say so rather than silently plotting a discontinuity.
