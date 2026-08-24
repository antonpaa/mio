# Compliance register

Open regulatory, legal and clinical items. Each needs an owner and a decision
date. Engineering can frame these; it cannot answer them.

The gate these items feed is
[`release-checklist.md`](release-checklist.md) (WP-33): no pilot release
while a blocking R-item is open.

> **This document is not legal or regulatory advice.** It is an engineering
> record of what needs professional determination, with the reasoning that
> raised each item. Where a classification is stated, it is a reading of the
> regulation, not an opinion from a qualified party.

**Status key:** 🔴 blocking; 🟠 needed before go-live; 🟡 needed before the
relevant subsystem ships; ⚪ track only

---

## R1 ✅ EU MDR 2017/745 classification — decided: not a medical device

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

**Owner decision (2026-08-24): Mio is not a medical device.** The
62304-shaped discipline (traceability, evaluation traces, SOUP
inventory, change control) stays as engineering practice — it was built
in and costs little to keep — but no QMS, clinical evaluation or
notified body follows. If the product's claims ever change toward
diagnosis or therapy decisions, this item reopens before that change
ships.

| Owner | Needed by | Status |
|---|---|---|
| Product owner | — | ✅ Decided 2026-08-24 |

---

## R2 ✅ Finnish system classification — decided: Class B

**Question.** Is Mio a Class A or Class B client and patient data system, and
what registration and self-declaration obligations follow?

**Engineering reading.** Standalone with no Kanta connection, most likely
Class B — self-declared conformance plus registration in THL's register, rather
than accredited certification. Requires confirmation.

**Dependency.** If Kanta integration is ever in scope, this becomes Class A,
with certification and an information security assessment by an accredited body.
Out of scope for v1 but it should be a conscious exclusion, not an oversight.

**Owner decision (2026-08-24): Class B — no Kanta connection.** Kanta
integration is a conceivable future extension but explicitly not on the
roadmap; if it ever is, this item reopens as a Class A question before
that work starts. The THL registration filing itself remains an
administrative step before go-live (release checklist).

| Owner | Needed by | Status |
|---|---|---|
| Product owner | Filing before go-live | ✅ Decided 2026-08-24 (filing pending) |

---

## R3 ✅ Swedish requirements — decided: no Swedish deployment planned

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

**Owner decision (2026-08-24): not deployed in Sweden.** The Swedish
locale exists for Finland's Swedish-speaking users — Finnish and Swedish
are both official languages in Finland — not for a Swedish market. A
future Swedish deployment remains theoretically possible; this item
reopens (e-ID included) before any such plan is made.

| Owner | Needed by | Status |
|---|---|---|
| Product owner | Reopens before any Swedish deployment | ✅ Decided 2026-08-24 |

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

**Owner decision (2026-08-24): the DPIA is in scope of work conducted
outside tracked development.** This repository's contribution is the
support material above, kept current with the code; the assessment
itself proceeds elsewhere and this item stays open here only as the
release-blocking checkbox.

| Owner | Needed by | Status |
|---|---|---|
| Outside tracked development | Before processing real data | 🟠 In progress externally |

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

**Owner confirmation (2026-08-24):** the hold-everything default is
correct for the start. The periods themselves will be worked out
separately with profession specialists against the data model's
classes; until then nothing deletes.

| Owner | Needed by | Status |
|---|---|---|
| Profession specialists (separate work) | Before go-live | 🟠 Confirmed approach, periods pending |

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

**Owner acceptance (2026-08-24):** risk accepted as stated. Also
recorded in the threat model's accepted-risks section.

| Owner | Needed by | Status |
|---|---|---|
| Product owner | Reviewed at passkey fast-follow | ✅ Accepted 2026-08-24 |

---

## R7 ✅ Accessibility conformance — decided: no formal statement required

**Question.** Is a formal conformance statement needed (EN 301 549 / an
accessibility statement), given likely public-sector customers?

**Engineering note.** Automated tooling covers roughly 40% of WCAG issues.
A defensible claim needs manual audit. The body map and the recurrence editor
are the two components most likely to fail.

**Engineering position (WP-31).** The keyboard/ARIA contract is now
verified: dialog focus management shipped and proven live, the body map
and recurrence editor passed deep keyboard passes
([`../accessibility/keyboard-pass-2026-08.md`](../accessibility/keyboard-pass-2026-08.md)),
and the statement's factual skeleton is drafted at
[`../accessibility/statement.md`](../accessibility/statement.md). What
remains for a defensible claim is the assistive-technology session with
real screen-reader users — that, the publication surface and the FI/SV
statement text stay with this item's owner.

**Owner decision (2026-08-24): no formal EN 301 549 statement is
required — customers are private-sector only.** The engineering
accessibility work (axe in CI, the dialog focus contract, the pass
records) stays as product quality, not as a conformance claim; the
statement draft remains internal material. Reopens if a public-sector
customer ever appears.

| Owner | Needed by | Status |
|---|---|---|
| Product owner | Reopens on public-sector interest | ✅ Decided 2026-08-24 |

---

## R8 ✅ Subprocessors and data residency — decided: GCP Hamina, EU only

**Question.** Which subprocessors are permitted, and where may data reside?

**Current assumptions.** Patient data stays in the EU. Cloud is Azure or GCP,
undecided ([ADR-0010](../adr/0010-cloud-agnostic-container-platform.md)).
Transactional email uses an EU-hosted provider under a DPA. Email carries no
clinical content, so exposure there is contact data only — still personal data.

Needed: a subprocessor register and a DPA per subprocessor.

**Owner decision (2026-08-24): GCP, Finland region (Hamina —
`europe-north1`, which the infrastructure already pins); data stays in
the EU only.** The assumptions above stand confirmed. The subprocessor
register and per-subprocessor DPAs remain administrative steps before
go-live.

| Owner | Needed by | Status |
|---|---|---|
| Product owner | DPAs before go-live | ✅ Decided 2026-08-24 (DPAs pending) |

---

## R9 ⚪ NIS2

**Question.** Do NIS2 obligations flow down to Mio as a supplier to hospitals,
which are essential entities?

**Owner position (2026-08-24): somewhat, yes — and the adopting
enterprise carries it.** Each adopting hospital ensures its NIS2
compliance the same way it conducts the DPIA; Mio's role is supplier
support material (threat model, SOUP inventory, runbooks, this
register), which already exists and stays current.

| Owner | Needed by | Status |
|---|---|---|
| Adopting enterprise per deployment | Per adoption | ✅ Positioned 2026-08-24 |

---

## R10 ⚪ European Health Data Space

**Question.** What will EHDS require of Mio, and on what timeline?

**Owner position (2026-08-24): genuinely unknown today; researchable at
a future stage.** Stays parked deliberately.

**Engineering note.** Not a v1 concern. Relevant to how much interoperability
groundwork is worth laying now — the optional SNOMED CT coded fields on body map
regions ([`../architecture/surveys-and-alerts.md`](../architecture/surveys-and-alerts.md))
are cheap insurance of this kind.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Track | ⚪ Open |

---

## R11 ✅ Licensed instruments — decided: nothing licensed ships in the platform

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

**Owner decision (2026-08-24): instruments are BUILT in the system, not
hardcoded into it.** A post-treatment follow-up survey of this kind
(lower-frequency recurrence monitoring — cancers recur) is authored in
the builder by the adopting organisation, and its validity and any
licensing are that organisation's responsibility at the moment of
building. The platform ships no licensed instrument, so no EORTC
agreement attaches to Mio itself; the shipped synthetic catalog contains
house-built surveys only (verified). The builder's read-only marking for
licensed instruments remains a reasonable future aid, not an obligation.

| Owner | Needed by | Status |
|---|---|---|
| Authoring organisation, at build time | — | ✅ Decided 2026-08-24 |

---

## R12 🟠 External penetration test

**Question.** Who performs the WP-30 penetration test, when, and against
which environment?

**Owner decision (2026-08-24): an external security-testing provider,
tracked outside this repository.** The threat model stays the briefing
document and staging the intended target; findings still land here.

**Engineering position.** The system is ready to be tested: the threat
model ([`../security/threat-model.md`](../security/threat-model.md)) is
the briefing document, staging (WP-09) the target environment, and the
named priority targets are authentication and the attachment pipeline.
Findings land here with owners; a finding against a runtime dependency
also lands in the SOUP inventory.

**Consequence if unresolved.** No independent validation of the
security posture before pilot.

| Owner | Needed by | Status |
|---|---|---|
| TBD | Before pilot (M5) | 🟠 Open |

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
| P8 | Reporting screen placement: designed in the admin shell (A4), but its metrics are clinical aggregates that administrators cannot read | **Decided (owner, 2026-08-24): moved to the clinician shell — implemented.** A4 renders for `report.view` holders (clinical roles), scoped to the caller's own treatments and aggregated in-database; administrators keep no route to it (reconciliation X12) |

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
