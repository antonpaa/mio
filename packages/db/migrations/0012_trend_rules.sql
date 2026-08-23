-- 0012 Trend rules (WP-20): occurrence-anchored firings, custom
-- notifications and rule-created tasks
-- (docs/architecture/surveys-and-alerts.md).
--
-- Missed-response rules fire with NO response row, so triggers anchor to
-- the occurrence instead; the unique pairs below make evaluation
-- idempotent - a re-run sweep or a retried transaction cannot double-fire
-- the same rule on the same anchor.

ALTER TABLE clinical.rule_trigger
  ADD COLUMN activity_id uuid REFERENCES clinical.activity (id);
CREATE UNIQUE INDEX rule_trigger_once_per_response
  ON clinical.rule_trigger (rule_id, survey_response_id)
  WHERE survey_response_id IS NOT NULL;
CREATE UNIQUE INDEX rule_trigger_once_per_occurrence
  ON clinical.rule_trigger (rule_id, activity_id)
  WHERE activity_id IS NOT NULL AND survey_response_id IS NULL;

-- A custom notification, delivered AS WRITTEN, in-app only: to the team,
-- the lead, and/or the patient. The body is a locale -> text map of the
-- authored texts; WP-25 renders it into the Updates feed and the
-- notification centre. Clinical content NEVER rides the email layer.
CREATE TABLE clinical.rule_notification (
  id           uuid PRIMARY KEY,
  treatment_id uuid NOT NULL REFERENCES clinical.treatment (id),
  patient_id   uuid NOT NULL,
  trigger_id   uuid NOT NULL REFERENCES clinical.rule_trigger (id),
  recipients   text[] NOT NULL,
  body         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rule_notification_patient_idx
  ON clinical.rule_notification (patient_id, created_at DESC);
REVOKE UPDATE, DELETE ON clinical.rule_notification FROM mio_app, mio_worker;

ALTER TABLE clinical.rule_notification ENABLE ROW LEVEL SECURITY;
-- patients read ONLY notifications addressed to them; staff read via care
CREATE POLICY rule_notification_read ON clinical.rule_notification FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient'
        AND patient_id = app.current_user_id()
        AND 'patient' = ANY (recipients))
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.rule_notification.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY rule_notification_write ON clinical.rule_notification FOR INSERT
  WITH CHECK (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.rule_notification.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );

-- The worker's missed-window evaluation resolves the treatment's
-- EFFECTIVE survey version, which needs system-realm read arms the
-- catalog tables never had (their readers were people until now).
CREATE POLICY treatment_survey_read_system ON clinical.treatment_survey FOR SELECT
  USING (app.current_realm() = 'system');
CREATE POLICY survey_version_read_system ON clinical.survey_version FOR SELECT
  USING (app.current_realm() = 'system');
CREATE POLICY survey_read_system ON clinical.survey FOR SELECT
  USING (app.current_realm() = 'system');

-- Rule-created tasks: no human author (created_by NULL = "created by
-- rule"; the trigger trace names which), landing unclaimed in the team
-- queue. The worker's missed-response path and the patient's submit
-- transaction both insert them, so both realms get INSERT arms.
ALTER TABLE clinical.task ALTER COLUMN created_by DROP NOT NULL;
CREATE POLICY task_write_system ON clinical.task FOR INSERT
  WITH CHECK (app.current_realm() = 'system');
CREATE POLICY task_write_patient ON clinical.task FOR INSERT
  WITH CHECK (app.current_realm() = 'patient' AND patient_id = app.current_user_id());
