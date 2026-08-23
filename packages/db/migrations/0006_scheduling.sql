-- 0006 Scheduling: recurrence definitions and materialised activities
-- (docs/architecture/scheduling.md, WP-12).
--
-- The schedule stores the RULE (phased RFC 5545-shaped segments, expanded
-- as LOCAL DATES in the patient's timezone); materialisation turns
-- occurrences into activity rows so calendars are ordinary SQL and every
-- occurrence has an identity a human can confirm, complete or cancel.

CREATE TABLE clinical.schedule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id    uuid NOT NULL REFERENCES clinical.treatment (id),
  patient_id      uuid NOT NULL,
  timezone        text NOT NULL,
  anchor_date     date NOT NULL,
  segments        jsonb NOT NULL,
  add_dates       jsonb,
  remove_dates    jsonb,
  -- What each occurrence becomes: {title, kind, location?, timeOfDay?}.
  payload         jsonb NOT NULL,
  -- Survey-window knobs (T3) live here already; WP-17 wires them.
  answer_window_days   integer,
  reminder_after_days  integer,
  escalate_unanswered  boolean NOT NULL DEFAULT false,
  generated_until date,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);
CREATE INDEX schedule_treatment_idx ON clinical.schedule (treatment_id) WHERE ended_at IS NULL;

CREATE TABLE clinical.activity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id    uuid NOT NULL REFERENCES clinical.treatment (id),
  patient_id      uuid NOT NULL,
  schedule_id     uuid REFERENCES clinical.schedule (id),
  occurrence_date date,
  title           text NOT NULL,
  kind            text NOT NULL DEFAULT 'other'
                  CHECK (kind IN ('visit', 'lab', 'infusion', 'survey', 'other')),
  location        text,
  -- Timed activities store the UTC instant; date-only ones leave it NULL
  -- and live by occurrence_date in the patient's timezone.
  scheduled_at    timestamptz,
  status          text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'confirmed', 'completed', 'cancelled')),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX activity_schedule_occurrence_idx
  ON clinical.activity (schedule_id, occurrence_date) WHERE schedule_id IS NOT NULL;
CREATE INDEX activity_patient_idx ON clinical.activity (patient_id, occurrence_date, scheduled_at);
CREATE INDEX activity_treatment_idx ON clinical.activity (treatment_id);

-- Same backstop shape as clinical.treatment.
ALTER TABLE clinical.activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_read ON clinical.activity FOR SELECT
  USING (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.activity.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY activity_write ON clinical.activity FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');
CREATE POLICY activity_update ON clinical.activity FOR UPDATE
  USING (
    app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.activity.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );
-- Regenerating a schedule's future is the ONLY delete in the clinical
-- schema (0001 grants none by default): machine-made, still-planned rows
-- only. Anything a human touched keeps its identity through an edit.
GRANT DELETE ON clinical.activity TO mio_app;
CREATE POLICY activity_delete ON clinical.activity FOR DELETE
  USING (
    app.current_realm() = 'staff'
    AND schedule_id IS NOT NULL AND status = 'planned'
    AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.activity.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );

ALTER TABLE clinical.schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedule_read ON clinical.schedule FOR SELECT
  USING (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.schedule.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY schedule_write ON clinical.schedule FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');
CREATE POLICY schedule_update ON clinical.schedule FOR UPDATE
  USING (app.current_realm() = 'staff');
