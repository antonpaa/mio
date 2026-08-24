-- 0013 Observations (WP-21): value series + entries with provenance, the
-- symptom taxonomy and taxonomy-coded observations
-- (docs/architecture/observations.md).
--
-- Values and symptom observations are per-patient clinical record that
-- exists independently of any single survey. Provenance is COLUMNS
-- ("entered by X on behalf of the patient"), never inferred from audit.
-- Interpretation (expected vs alarming) is the rule engine's job and is
-- never stored on an observation.

CREATE TABLE clinical.value_series (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE,
  name       text NOT NULL,
  unit       text NOT NULL,
  kind       text NOT NULL DEFAULT 'numeric' CHECK (kind IN ('numeric', 'reported_marker')),
  -- optional coded field keeps a future lab mapping cheap without
  -- importing that weight now (deliberately not FHIR)
  loinc_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which series a patient has follows from their programs: a treatment
-- template brings series with it.
CREATE TABLE clinical.template_value_series (
  template_id uuid NOT NULL REFERENCES clinical.treatment_template (id),
  series_id   uuid NOT NULL REFERENCES clinical.value_series (id),
  PRIMARY KEY (template_id, series_id)
);

CREATE TABLE clinical.value_entry (
  id                   uuid PRIMARY KEY,
  series_id            uuid NOT NULL REFERENCES clinical.value_series (id),
  patient_id           uuid NOT NULL,
  value                numeric,
  measured_at          date NOT NULL,
  note                 text NOT NULL DEFAULT '',
  entered_by           uuid NOT NULL,
  on_behalf_of_patient boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX value_entry_series_idx
  ON clinical.value_entry (patient_id, series_id, measured_at DESC);

-- The taxonomy: system reference data, Finnish canonical, growing under
-- Treatment Lead authoring (matrix: symptom_taxonomy.manage). The 27
-- handoff entries ship with the schema.
CREATE TABLE clinical.symptom (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  label_en    text NOT NULL,
  label_fi    text NOT NULL,
  label_sv    text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  snomed_code text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO clinical.symptom (code, label_en, label_fi, label_sv) VALUES
  ('nausea', 'Nausea', 'Pahoinvointi', 'Illamående'),
  ('vomiting', 'Vomiting', 'Oksentelu', 'Kräkningar'),
  ('fatigue', 'Fatigue', 'Väsymys', 'Trötthet'),
  ('fever', 'Fever', 'Kuume', 'Feber'),
  ('neuropathy', 'Neuropathy', 'Neuropatia', 'Neuropati'),
  ('decreased_appetite', 'Decreased appetite', 'Ruokahalun väheneminen', 'Nedsatt aptit'),
  ('skin_change', 'Rash / skin change', 'Ihottuma / ihomuutos', 'Hudutslag / hudförändring'),
  ('joint_pain', 'Joint pain', 'Nivelkipu', 'Ledvärk'),
  ('diarrhea', 'Diarrhea', 'Ripuli', 'Diarré'),
  ('constipation', 'Constipation', 'Ummetus', 'Förstoppning'),
  ('swelling', 'Swelling', 'Turvotus', 'Svullnad'),
  ('cough', 'Cough', 'Yskä', 'Hosta'),
  ('shortness_of_breath', 'Shortness of breath', 'Hengenahdistus', 'Andnöd'),
  ('dry_mouth', 'Dry mouth', 'Suun kuivuminen', 'Muntorrhet'),
  ('oral_mucosal_damage', 'Oral mucosal damage', 'Suun limakalvovauriot', 'Skador på munslemhinnan'),
  ('pain', 'Pain', 'Kipu', 'Smärta'),
  ('cold_sensitivity', 'Cold sensitivity', 'Paleltumat', 'Köldkänslighet'),
  ('other_symptoms', 'Other symptoms', 'Muut oireet', 'Övriga symtom'),
  ('erectile_dysfunction', 'Erectile dysfunction', 'Erektiohäiriö', 'Erektil dysfunktion'),
  ('prostate_pain', 'Prostate pain', 'Eturauhasen kipu', 'Prostatasmärta'),
  ('painful_urination', 'Painful urination', 'Kivulias virtsaaminen', 'Smärtsam urinering'),
  ('urinary_frequency', 'Urinary frequency', 'Tihentynyt virtsaamisen tarve', 'Täta urinträngningar'),
  ('hematuria', 'Hematuria', 'Verivirtsaisuus', 'Blod i urinen'),
  ('urinary_incontinence', 'Urinary incontinence', 'Virtsan karkailu', 'Urininkontinens'),
  ('urinary_urgency', 'Urinary urgency', 'Virtsapakko', 'Urinträngningar'),
  ('urinary_retention', 'Urinary retention', 'Virtsaumpi', 'Urinstämma'),
  ('anal_pain', 'Anal pain', 'Peräaukon kipu', 'Analsmärta');

CREATE TABLE clinical.symptom_observation (
  id                   uuid PRIMARY KEY,
  patient_id           uuid NOT NULL,
  treatment_id         uuid REFERENCES clinical.treatment (id),
  symptom_id           uuid NOT NULL REFERENCES clinical.symptom (id),
  severity             text NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  -- structured detail: body-map regions, free text for "other symptoms"
  detail               jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at          date NOT NULL,
  source               text NOT NULL CHECK (source IN ('survey', 'self_report', 'clinician')),
  survey_response_id   uuid REFERENCES clinical.survey_response (id),
  entered_by           uuid NOT NULL,
  on_behalf_of_patient boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX symptom_observation_register_idx
  ON clinical.symptom_observation (patient_id, symptom_id, observed_at DESC);
CREATE INDEX symptom_observation_response_idx
  ON clinical.symptom_observation (survey_response_id);

-- RLS. The observation record is a fact; who may see it is exactly who
-- may see the patient (self + active care relationship + system jobs).
ALTER TABLE clinical.value_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY value_series_read ON clinical.value_series FOR SELECT
  USING (app.current_realm() IN ('staff', 'patient', 'system'));
CREATE POLICY value_series_write ON clinical.value_series FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');

ALTER TABLE clinical.template_value_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY template_value_series_read ON clinical.template_value_series FOR SELECT
  USING (app.current_realm() IN ('staff', 'patient', 'system'));
CREATE POLICY template_value_series_write ON clinical.template_value_series FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');

ALTER TABLE clinical.value_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY value_entry_read ON clinical.value_entry FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.value_entry.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY value_entry_write ON clinical.value_entry FOR INSERT
  WITH CHECK (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.value_entry.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );

ALTER TABLE clinical.symptom ENABLE ROW LEVEL SECURITY;
CREATE POLICY symptom_read ON clinical.symptom FOR SELECT
  USING (app.current_realm() IN ('staff', 'patient', 'system'));
CREATE POLICY symptom_write ON clinical.symptom FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');
CREATE POLICY symptom_update ON clinical.symptom FOR UPDATE
  USING (app.current_realm() = 'staff');

ALTER TABLE clinical.symptom_observation ENABLE ROW LEVEL SECURITY;
CREATE POLICY symptom_observation_read ON clinical.symptom_observation FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.symptom_observation.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY symptom_observation_write ON clinical.symptom_observation FOR INSERT
  WITH CHECK (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.symptom_observation.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
