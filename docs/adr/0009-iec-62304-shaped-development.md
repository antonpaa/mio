# 0009. IEC 62304-shaped development, MDR classification decided before go-live

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

Mio's surveys compute graded "increased risk" alerts from patient-reported
outcomes and route them to a care team with severity levels.

Under EU MDR 2017/745, Rule 11, software intended to provide information used to
take decisions with diagnostic or therapeutic purposes is **Class IIa** or
higher. Symptom-monitoring ePRO products with risk grading routinely fall in
scope. On the face of the brief, Mio plausibly does.

If it does, the obligations are ISO 13485 (quality management system), IEC 62304
(software lifecycle), ISO 14971 (risk management) and a clinical evaluation —
a large multiplier on cost and schedule.

**This has not been assessed by a regulatory professional.** The classification
above is an engineering reading of Rule 11, not advice.

Separately, Finland's asiakastietolaki (703/2023) classifies client and patient
data systems as Class A or Class B. Standalone with no Kanta connection, Mio is
most likely Class B — self-declared conformance plus registration in THL's
register rather than accredited certification. Sweden's equivalent framework is
Patientdatalagen (2008:355) with Socialstyrelsen's HSLF-FS 2016:40. Both need
confirmation.

## Decision

Build v1 with **IEC 62304-shaped discipline**, and obtain a formal MDR
classification opinion before go-live rather than before build.

Concretely, from day one:

- **Requirements traceability.** Every clinical requirement traces to design,
  implementation and test.
- **Deterministic alert evaluation with a stored evaluation trace.** Every alert
  records which answers, which rule, which threshold and which template version
  produced it, such that the decision can be reconstructed exactly
  (`docs/architecture/surveys-and-alerts.md`).
- **Documented risk analysis** for the clinical paths — alerting, messaging,
  survey scheduling — maintained as the design evolves.
- **A SOUP inventory**: every third-party dependency listed with version,
  purpose and justification. This is a standing reason to keep dependency count
  low (ADR-0003).
- **Architecture decision records** (ADR-0001) as design rationale evidence.
- **Change control**: reviewed pull requests, no direct pushes to `main`, a
  traceable link from change to reason.

Tracked to a decision in `docs/compliance/register.md`, with an owner and a date.

## Consequences

- Most of the cost is engineering discipline that a clinical system warrants
  regardless of regulatory outcome. Little of it is wasted if Mio turns out to
  be out of scope.
- Full Class IIa certification stays reachable without re-architecting. The
  expensive parts of 62304 to retrofit are traceability and design history, and
  those accrue from the start.
- Development is measurably slower than an unregulated project of the same size.
  This is the deliberate trade.
- **Schedule risk is real and not eliminated.** If the classification comes back
  Class IIa late, a QMS and clinical evaluation still stand between the software
  and market. The mitigation is to seek the opinion early — this is the
  highest-priority open item in the compliance register — not to rely on the
  discipline alone.
- Alert rule authoring is a regulated-adjacent capability. It is restricted in
  the capability matrix and flagged there for that reason.

## Alternatives considered

**Certify as Class IIa from day one.** Highest confidence, no late scramble, but
a large cost multiplier before the product is validated and it needs a
regulatory lead on the team immediately.

**Constrain v1 to stay out of scope** — transport and display clinician-authored
thresholds with no interpretation by the software. Avoids MDR for v1 but
materially weakens the product against the brief, and defers rather than settles
the question.

**Defer all regulatory work.** Rejected: traceability and design history cannot
be reconstructed credibly after the fact.
