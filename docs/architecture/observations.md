# Observations — values and symptoms

New module introduced by the design package
([ADR-0011](../adr/0011-absorb-design-package-scope.md)). It owns two kinds of
per-patient clinical record that exist independently of any single survey:
**values** (numeric measurements over time) and **symptom observations**
(taxonomy-coded symptom reports with severity).

Both are `clinical.*` data with full care-relationship scoping, provenance and
audit, like everything else patient-scoped.

## Values

A **value series** is a named, unit-bearing measurement track — the canvases
show *PSA value* (µg/l), *Testosterone* (nmol/l) and the compliance-style
*PSA reporting* (reported / not reported per period).

```
clinical.value_series      name, unit, kind (numeric | reported-marker)
clinical.value_entry       series, patient_id, value, measured/reported date,
                           entered_by, on_behalf_of_patient, note
```

- Entries come from the patient, or from a clinician **on behalf of the
  patient** — provenance is columns on the entry and always rendered
  ("entered by Dr Koskinen on behalf of patient", PP2), never inferred from
  the audit log.
- The clinician UI shows the 3 latest per series on the patient summary, and a
  full page per series: 12-month chart + all-records table with provenance
  and notes.
- A trend label per series (rising / stable / on schedule) is **display
  derivation, not stored clinical judgement** — computed from the entries at
  render time by a documented, deterministic rule.
- Survey responses can feed a series (the *PSA reporting* survey produces the
  PSA data): the binding mechanism between a numeric question and a series is
  an open decision — reconciliation X8 / register P7. Until decided, direct
  entry is the only writer.

Which series exist per patient follows from their programs; series definitions
belong to the catalog side (a treatment template can bring series with it).
Kept deliberately small: this is not a lab-integration model, and it is not
FHIR — optional coded fields (LOINC on a series) keep a future mapping cheap
without importing that weight now.

## Symptoms

### The taxonomy

A system-level, growing list of symptom concepts — 27 at handoff, **Finnish
canonical** with EN working translations (the full trilingual table lives in
[`../glossary.md`](../glossary.md)). Entries range from *nausea* and
*neuropathy* to urology-specific concepts, plus *other symptoms* as the
free-text catch-all. QLQ-30 appears in the source list but is an instrument,
not a symptom — it lives in the survey catalog (and carries a licensing
obligation, register R11).

```
clinical.symptom            taxonomy entry: code, labels EN/FI/SV, active flag,
                            optional SNOMED CT code
clinical.symptom_observation patient_id, symptom, severity, detail (e.g. body-map
                            areas), observed_at, source, entered_by, on_behalf
```

The taxonomy is reference data managed like the survey catalog (Treatment Lead
authoring), not a hard-coded enum — "list may grow" is in the brief.

### Sources

A symptom observation arrives three ways, and the record always says which
(PP3's *Source* column):

1. **Survey answers.** A survey question is mapped to a taxonomy entry
   ("Nausea", "Skin change"); submitting the response writes the observation.
   This mapping is part of the survey definition and versions with it.
2. **Ad-hoc report** — "Report a symptom": a short taxonomy-first entry, by the
   patient (self-report) or by a clinician on behalf with provenance. The
   patient-side flow is not yet designed (reconciliation X7).
3. **Clinician entry** during other work (phone call → on-behalf report).

### Program-specific interpretation

The defining rule, from the brief and PP3/C7: **whether a symptom is expected
or alarming depends on the treatment program.** Mild neuropathy is expected in
a docetaxel program and a trigger elsewhere. Therefore:

- An observation stores the *fact* (symptom, severity, detail). It never
  stores "alarming".
- Interpretation happens in the rule engine
  ([`surveys-and-alerts.md`](surveys-and-alerts.md)) against the **program's
  effective rule set**, producing triggers and alerts that trace back to the
  exact observations and rules involved.
- The clinician symptom register renders both: the observation and its
  standing against the active program's rules ("Moderate — trigger",
  "Mild — expected in this program"), with the context line spelled out
  ("In the docetaxel program mild neuropathy is expected — moderate or worse
  raises a trigger").

### Trends

The symptom register shows per-symptom trend (new / worsening / stable /
easing / resolved) across recent observations. Like value trends, this is
deterministic display derivation. Trend *rules* — the ones with consequences —
are the rule engine's job, not the register's.

## Capabilities

Added to the capability matrix: `value_entry` (view / create, patient self and
care-relationship on-behalf), `symptom_observation` (same shape), and the
taxonomy under Treatment Lead authoring. Reads are patient-scoped and audited
always. Administrators: deny, as for all clinical resources.

## What this module is not

Not a lab interface, not an EHR problem list, not a diagnosis record. It is
the minimal structure that lets a care team see "what has this patient
reported, how is it moving, and what does that mean *in this program*" —
which is the clinical heart of the product the design describes.
