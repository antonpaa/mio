-- 0008 Surveys: catalog, immutable versions, treatment attachment and
-- responses (docs/architecture/surveys-and-alerts.md, WP-14).
--
-- A published version is IMMUTABLE - the trigger below enforces the rule
-- at the storage layer, not just in service code. A response binds to the
-- exact survey_version plus the locale answered in plus a hash of the
-- rendered question set, so "what did the patient actually see" has one
-- answer forever.

CREATE TABLE clinical.survey (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'generic' CHECK (kind IN ('generic', 'symptom')),
  -- R11: licensing provenance, so a validated instrument is
  -- distinguishable from a house-built one in the catalog
  licensed_source text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinical.survey_version (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id    uuid NOT NULL REFERENCES clinical.survey (id),
  version      integer NOT NULL,
  state        text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
  -- SurveyDefinition (structure, conditions, validation - no text)
  definition   jsonb NOT NULL,
  -- LocaleBundle[] (every human-readable string, per locale)
  locales      jsonb NOT NULL,
  content_hash text NOT NULL,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (survey_id, version)
);

-- Published versions freeze their content; only draft -> published and
-- published -> archived transitions may touch the row afterwards.
CREATE FUNCTION app.survey_version_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' AND (
    NEW.definition IS DISTINCT FROM OLD.definition
    OR NEW.locales IS DISTINCT FROM OLD.locales
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.survey_id IS DISTINCT FROM OLD.survey_id
  ) THEN
    RAISE EXCEPTION 'published survey versions are immutable';
  END IF;
  IF OLD.state = 'archived' AND NEW.state <> 'archived' THEN
    RAISE EXCEPTION 'archived survey versions stay archived';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER survey_version_freeze BEFORE UPDATE ON clinical.survey_version
  FOR EACH ROW EXECUTE FUNCTION app.survey_version_freeze();

-- Surveys <-> treatments are many-to-many; NULL pinned version = "newest
-- published at fill time" (T4 default).
CREATE TABLE clinical.treatment_survey (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id      uuid NOT NULL REFERENCES clinical.treatment (id),
  survey_id         uuid NOT NULL REFERENCES clinical.survey (id),
  pinned_version_id uuid REFERENCES clinical.survey_version (id),
  added_by          uuid NOT NULL,
  added_at          timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz,
  UNIQUE (treatment_id, survey_id)
);
CREATE INDEX treatment_survey_treatment_idx
  ON clinical.treatment_survey (treatment_id) WHERE removed_at IS NULL;

CREATE TABLE clinical.survey_response (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_version_id uuid NOT NULL REFERENCES clinical.survey_version (id),
  treatment_id      uuid NOT NULL REFERENCES clinical.treatment (id),
  patient_id        uuid NOT NULL,
  -- WP-17 binds scheduled occurrences; ad-hoc fills leave it NULL
  activity_id       uuid REFERENCES clinical.activity (id),
  locale            text NOT NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  answers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash      text NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz,
  -- PP4 provenance: set when a clinician fills on behalf of the patient
  on_behalf_by      uuid
);
CREATE INDEX survey_response_patient_idx
  ON clinical.survey_response (patient_id, status, submitted_at DESC);
CREATE INDEX survey_response_treatment_idx ON clinical.survey_response (treatment_id);
-- one open ad-hoc draft per patient x treatment x version
CREATE UNIQUE INDEX survey_response_open_draft_idx
  ON clinical.survey_response (patient_id, treatment_id, survey_version_id)
  WHERE status = 'draft' AND activity_id IS NULL;

-- RLS backstops. Patients read catalog rows only through their own
-- treatments' attachments; staff scoping is Cedar's job (survey_template
-- view is 'any' for clinicians in the matrix).
ALTER TABLE clinical.survey ENABLE ROW LEVEL SECURITY;
CREATE POLICY survey_read ON clinical.survey FOR SELECT
  USING (
    app.current_realm() = 'staff'
    OR (app.current_realm() = 'patient' AND EXISTS (
      SELECT 1 FROM clinical.treatment_survey ts
      JOIN clinical.treatment t ON t.id = ts.treatment_id
     WHERE ts.survey_id = clinical.survey.id AND ts.removed_at IS NULL
       AND t.patient_id = app.current_user_id()
    ))
  );
CREATE POLICY survey_write ON clinical.survey FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');

ALTER TABLE clinical.survey_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY survey_version_read ON clinical.survey_version FOR SELECT
  USING (
    app.current_realm() = 'staff'
    OR (app.current_realm() = 'patient' AND (
      EXISTS (
        SELECT 1 FROM clinical.survey_response r
         WHERE r.survey_version_id = clinical.survey_version.id
           AND r.patient_id = app.current_user_id()
      )
      OR (state = 'published' AND EXISTS (
        SELECT 1 FROM clinical.treatment_survey ts
        JOIN clinical.treatment t ON t.id = ts.treatment_id
       WHERE ts.survey_id = clinical.survey_version.survey_id
         AND ts.removed_at IS NULL AND t.patient_id = app.current_user_id()
      ))
    ))
  );
CREATE POLICY survey_version_write ON clinical.survey_version FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');
CREATE POLICY survey_version_update ON clinical.survey_version FOR UPDATE
  USING (app.current_realm() = 'staff');

ALTER TABLE clinical.treatment_survey ENABLE ROW LEVEL SECURITY;
CREATE POLICY treatment_survey_read ON clinical.treatment_survey FOR SELECT
  USING (
    app.current_realm() = 'staff'
    OR (app.current_realm() = 'patient' AND EXISTS (
      SELECT 1 FROM clinical.treatment t
       WHERE t.id = clinical.treatment_survey.treatment_id
         AND t.patient_id = app.current_user_id()
    ))
  );
CREATE POLICY treatment_survey_write ON clinical.treatment_survey FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');
CREATE POLICY treatment_survey_update ON clinical.treatment_survey FOR UPDATE
  USING (app.current_realm() = 'staff');

ALTER TABLE clinical.survey_response ENABLE ROW LEVEL SECURITY;
CREATE POLICY survey_response_read ON clinical.survey_response FOR SELECT
  USING (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.survey_response.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY survey_response_write ON clinical.survey_response FOR INSERT
  WITH CHECK (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR app.current_realm() = 'staff'
  );
CREATE POLICY survey_response_update ON clinical.survey_response FOR UPDATE
  USING (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.survey_response.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
