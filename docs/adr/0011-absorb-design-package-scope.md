# 0011. Absorb the design-package scope: observations and generalized rule outcomes

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

The approved design package (`design/handoff-2026-08-21/`, analyzed in
[`../design/README.md`](../design/README.md)) is the first complete statement of
the product's extent, and it goes materially beyond the brief the architecture
was documented against. Three additions are architectural rather than cosmetic:

1. **Values.** Clinicians and patients record numeric measurements over time —
   PSA, testosterone — with provenance, trend display and a full-records view.
   This is a lightweight observations model that no existing module owns.
2. **Symptoms.** A first-class, growing symptom taxonomy (27 entries, Finnish
   canonical). Symptom observations arrive from survey answers *and* from
   ad-hoc reports; the clinician sees a per-patient symptom register with
   trends. Whether a symptom is expected or alarming is decided **per treatment
   program**, not per survey.
3. **Generalized rule outcomes.** Survey rules are no longer only
   "answer → alert". Conditions can span consecutive responses ("at least
   Moderate for 3 surveys in a row", "no response 2 times in a row"), and the
   consequence is configurable: raise an alert with severity, send a custom
   notification with authored text (to team, a role, or the patient), create a
   task in the team queue, or record-only. Rules also fire when a due date
   passes unanswered — evaluation is no longer submission-triggered only.

## Decision

- Add an **`observations` module** to the modular monolith (ADR-0002), owning
  value series, value entries and symptom observations, with the same
  care-relationship scoping, provenance and audit obligations as every other
  clinical module. Specified in
  [`../architecture/observations.md`](../architecture/observations.md).
- Generalize the alert engine into a **rule engine with outcomes**: one
  deterministic evaluator whose rule model covers single-response conditions,
  cross-response trend conditions and missed-response conditions, and whose
  outcomes are alert, custom notification, task, or record-only — in any
  combination. Evaluation traces (ADR-0009) extend to every outcome, not only
  alerts. Specified in
  [`../architecture/surveys-and-alerts.md`](../architecture/surveys-and-alerts.md).
- Treat **program-specific rule overrides** as part of the treatment, not the
  survey: a survey version carries template-default rules; attaching it to a
  treatment program may override thresholds and critical body-map areas, and
  responses are always evaluated against the program's effective rule set,
  which is itself versioned and traceable.

## Consequences

- The worker gains a scheduled evaluation duty: when a materialised survey
  occurrence passes unanswered, trend rules run. Missed-response outcomes are
  therefore as reliable as the queue (ADR-0008), not best-effort.
- Custom notifications carry clinician-authored text that is clinical content.
  They exist **in-app only**; the email layer remains type-and-deeplink with no
  access to content. The structural guarantee about email is unchanged; the
  in-app notification centre is now explicitly a clinical-content surface with
  care-relationship access control.
- The evaluation trace must capture more: which prior responses a trend
  condition read, and which program override layer supplied each threshold.
  This grows the MDR-relevant evidence (ADR-0009) rather than weakening it —
  but it also deepens the Rule 11 exposure, since the software now initiates
  notifications and tasks from clinical conditions, not only graded flags.
  R1 in the compliance register gains urgency, not less.
- One evaluator, one trace format, one audit path — instead of a special-cased
  alert path plus ad-hoc notification logic scattered per feature.

## Alternatives considered

**Keep alerts special-cased and bolt notifications/tasks on per feature.**
Rejected: three slightly different evaluation paths over the same clinical
data, three trace formats, and no single answer to "why did the system do
this?"

**Model values and symptoms inside `surveys`** (as derived views over
responses). Rejected: both have non-survey sources — direct entry and ad-hoc
reports with provenance — and clinicians address them as first-class records,
not as query results.

**Adopt full FHIR Observation semantics now.** Rejected for v1: Mio is
standalone with no integrations; a small purpose-built model with optional
coded fields keeps a future mapping cheap without importing FHIR's weight.
