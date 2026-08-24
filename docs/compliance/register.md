# Compliance register

Open regulatory, legal and clinical items. Each needs an owner and a decision
date. Engineering can frame these; it cannot answer them.

> **This document is not legal or regulatory advice.** It is an engineering
> record of what needs professional determination, with the reasoning that
> raised each item. Where a classification is stated, it is a reading of the
> regulation, not an opinion from a qualified party.

**Status key:** 🔴 blocking; 🟠 needed before go-live; 🟡 needed before the
relevant subsystem ships; ⚪ track only

---

## R1 🔴 EU MDR 2017/745 classification

**Question.** Is Mio a medical device, and at what class?

**Why it was raised.** Surveys compute graded "increased risk" alerts from
patient-reported outcomes and route them to a care team with severity levels.
Under Rule 11, software providing information used to take decisions with
diagnostic or therapeutic purposes is Class IIa or higher. Symptom-monitoring
ePRO products with risk grading routinely fall in scope.

**If Class IIa.** ISO 13485 quality management system, IEC 62304 software
lifecycle, ISO 14971 risk management, clinical evaluation, notified body
involvement.

**Current position.** Building v1 with 62304-shaped discipline and deciding
formally before go-live ([ADR-0009](../adr/0009-iec-62304-shaped-development.md)).

**Why this is the highest priority item.** The mitigation in ADR-0009 protects
the *architecture* from a late Class IIa finding. It does not protect the
*schedule*: a QMS and a clinical evaluation still take months that no amount of
engineering discipline compresses. This has external lead time and should be
started before build, not alongside it.

| Owner | Needed by | Status |
|---|---|---|
| TBD — regulatory advisor | Before alert engine build begins | 🔴 Open |

---

## R2 🟠 Finnish system classification — asiakastietolaki (703/2023)

**Question.** Is Mio a Class A or Class B client and patient data system, and
what registration and self-declaration obligations follow?

**Engineering reading.** Standalone with no Kanta connection, most likely
Class B — self-declared conformance plus registration in THL's register, rather
than accredited certification. Requires confirmation.

**Dependency.** If Kanta integration is ever in scope, this becomes Class A,
with certification and an information security assessment by an accredited body.
Out of scope for v1 but it should be a conscious exclusion, not an oversight.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Before go-live in Finland | 🟠 Open |

---

## R3 🟠 Swedish requirements — Patientdatalagen (2008:355)

**Question.** What does Patientdatalagen, with Socialstyrelsen's HSLF-FS
2016:40, require of Mio for Swedish deployment?

**Specific engineering concern.** Swedish healthcare practice expects staff
accessing patient records to authenticate with a strong e-ID — SITHS card or
BankID. **Email-delivered OTP is unlikely to satisfy this.**

If confirmed, Swedish launch depends on the e-ID work, not merely on
translation. The `AuthenticationProvider` interface
([`../architecture/authentication.md`](../architecture/authentication.md))
exists so this is an addition rather than a rewrite — but it is still work that
must be scheduled rather than discovered.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Before Swedish launch | 🟠 Open |

---

## R4 🟠 GDPR — DPIA and lawful basis

**Question.** Data protection impact assessment for large-scale processing of
health data (Article 35 — a DPIA is required, not optional), lawful basis under
Articles 6 and 9, controller/processor roles between Mio and each hospital, and
the record of processing activities.

**Note.** Controller/processor allocation shapes contracts and some product
behaviour — in particular who answers a data subject access request and how
"download my data" fits into it.

**Engineering position.** Support material for the DPIA — processing map,
technical measures, rights implementation, residual open items — is
maintained at [`dpia-support.md`](dpia-support.md) (WP-29).

| Owner | Needed by | Status |
|---|---|---|
| TBD — DPO | Before processing real data | 🟠 Open |

---

## R5 🟠 Retention periods

**Question.** Statutory retention for patient records in Finland and Sweden,
for clinical records, audit records and attachments; and correct handling of
deceased patients' data.

**Engineering position.** The data model supports per-record retention
classification ([`../architecture/data-model.md`](../architecture/data-model.md)).
The periods are a legal input. As of WP-29 the classes are live in
`audit.retention_policy` with NULL periods — NULL means hold, never
delete — so supplying the statutory numbers is a one-row update per
class, not a build. Deceased-patient handling (respectful stop of all
outbound automation, record retained) is implemented; only the "how
long" is open.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Before go-live | 🟠 Open |

---

## R6 🟠 Email OTP as a second factor — accepted risk

**Risk.** Email-delivered OTP shares a channel with password reset, so an
attacker with mailbox access holds both factors. It is closer to a single strong
factor than to true two-factor authentication.

**Accepted for v1** per the brief. Recorded here rather than left implicit.

**Mitigation path.** Passkeys/WebAuthn as fast-follow — better security *and*
better patient experience on phones, which is where most patients will be.
Suomi.fi e-Identification and Swedish BankID in v2. The provider interface is
already in the design.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Reviewed before go-live | 🟠 Accepted, tracked |

---

## R7 🟡 Accessibility conformance — WCAG 2.2 AA

**Question.** Is a formal conformance statement needed (EN 301 549 / an
accessibility statement), given likely public-sector customers?

**Engineering note.** Automated tooling covers roughly 40% of WCAG issues.
A defensible claim needs manual audit. The body map and the recurrence editor
are the two components most likely to fail.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Before public-sector sale | 🟡 Open |

---

## R8 🟡 Subprocessors and data residency

**Question.** Which subprocessors are permitted, and where may data reside?

**Current assumptions.** Patient data stays in the EU. Cloud is Azure or GCP,
undecided ([ADR-0010](../adr/0010-cloud-agnostic-container-platform.md)).
Transactional email uses an EU-hosted provider under a DPA. Email carries no
clinical content, so exposure there is contact data only — still personal data.

Needed: a subprocessor register and a DPA per subprocessor.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Before go-live | 🟡 Open |

---

## R9 ⚪ NIS2

**Question.** Do NIS2 obligations flow down to Mio as a supplier to hospitals,
which are essential entities?

| Owner | Needed by | Status |
|---|---|---|
| TBD | Track | ⚪ Open |

---

## R10 ⚪ European Health Data Space

**Question.** What will EHDS require of Mio, and on what timeline?

**Engineering note.** Not a v1 concern. Relevant to how much interoperability
groundwork is worth laying now — the optional SNOMED CT coded fields on body map
regions ([`../architecture/surveys-and-alerts.md`](../architecture/surveys-and-alerts.md))
are cheap insurance of this kind.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Track | ⚪ Open |

---

## R11 🟠 Licensed survey instruments — EORTC QLQ-C30

**Question.** The designed survey catalog includes *Quality of life (QLQ-30)*
— the EORTC QLQ-C30. Under what agreement may Mio use it, and what does that
agreement require?

**Engineering reading.** EORTC instruments require a usage agreement (royalty
terms differ for academic vs. commercial use), and their translations are
EORTC-validated — the Finnish and Swedish forms must be the official ones,
never re-translated or restructured in the builder. This generalizes: any
validated instrument (PROM) in the catalog carries licensing provenance, and
the builder must be able to mark an instrument read-only.

**Consequence if unresolved.** QLQ-C30 cannot ship in the catalog; house-built
surveys are unaffected.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Before QLQ-C30 is used with real patients | 🟠 Open |

---

## Product decisions pending

These are open in [`../authz/capability-matrix.yaml`](../authz/capability-matrix.yaml)
under `open_questions`, deliberately unresolved rather than settled by an
engineering guess.

| # | Question | Needs |
|---|---|---|
| P1 | Should Treatment Leads create patient accounts, or administrators only? | Operational decision — separation of duties versus an enrolment bottleneck |
| P2 | Who may read the full audit log? A dedicated auditor/DPO role? | DPO input — audit metadata reveals which patients have treatments. Design position: admin view shows initials-only subjects and generic event text (reconciliation X4) |
| P3 | Should survey authoring and alert-rule configuration be a separate capability? | Product decision — this is the regulated-adjacent capability (R1). Design's role matrix (A2) confirms the Treatment Lead default |
| P4 | Should patients see that an alert was raised from their responses? | **Clinical opinion.** Design position now on record: never severities or critical areas; a plain-language "closer look" note on submission, plus rule-authored patient notifications ([`../design/README.md`](../design/README.md)) — needs clinical sign-off |
| P5 | Is break-glass access outside a care relationship required? | Clinical and legal input |
| P6 | Patient-initiated symptom self-report: the data model and designs imply it (source "self-report", PP3/PP6), but no patient-side flow is designed | Product decision — design the flow or descope self-report to v1.1 (reconciliation X7) |
| P7 | How does a numeric survey question feed a value series (PSA reporting → PSA value)? | Product + engineering decision — recommended: explicit per-question binding in the builder (reconciliation X8) |
| P8 | Reporting screen placement: designed in the admin shell (A4), but its metrics are clinical aggregates that administrators cannot read | Move to clinician shell (Treatment Lead) or redefine metrics as de-identified counts (reconciliation X4/`reporting_shell_placement` in the matrix) |

---

## Standing engineering obligations

Not open questions — commitments that follow from decisions already taken.

| | Obligation | Source |
|---|---|---|
| E1 | SOUP inventory maintained for every dependency | [ADR-0009](../adr/0009-iec-62304-shaped-development.md) |
| E2 | Requirements traceability from clinical requirement to test | [ADR-0009](../adr/0009-iec-62304-shaped-development.md) |
| E3 | Alert evaluation traces stored and reconstructable | [ADR-0009](../adr/0009-iec-62304-shaped-development.md) |
| E4 | Risk analysis maintained as the design evolves | [ADR-0009](../adr/0009-iec-62304-shaped-development.md) |
| E5 | Threat model before build, revisited per subsystem | [`../architecture/platform.md`](../architecture/platform.md) |
| E6 | Penetration test before go-live | [`../architecture/platform.md`](../architecture/platform.md) |
| E7 | Restore rehearsals on a schedule, with evidence retained | [`../architecture/platform.md`](../architecture/platform.md) |
| E8 | No production data in non-production environments | [`../architecture/data-model.md`](../architecture/data-model.md) |
| E9 | No patient data in logs, traces or metrics | [`../architecture/platform.md`](../architecture/platform.md) |
| E10 | RPO and RTO targets defined | [`../architecture/platform.md`](../architecture/platform.md) |
| E11 | Fonts and all assets self-hosted — no third-party CDN requests from production pages | [`../design/design-system.md`](../design/design-system.md) |
| E12 | Authored survey regex constrained to a linear-time-safe subset and engine | [`../architecture/surveys-and-alerts.md`](../architecture/surveys-and-alerts.md) |
