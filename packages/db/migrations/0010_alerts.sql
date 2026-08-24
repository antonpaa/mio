-- 0010 Alerts: graded alerts, per-rule evaluation traces and the
-- notification outbox (docs/architecture/surveys-and-alerts.md, WP-18).
--
-- A TRIGGER is a single fired rule; an alert aggregates one or more
-- triggers and cites them. Every firing stores WHY - the answer read,
-- the condition, the threshold, which layer supplied it and every
-- outcome produced - from day one: if MDR lands Class IIa, this trace
-- is the evidence the software behaves as specified. Record-only
-- firings keep alert_id NULL: stored, visible in trends, nothing raised.

CREATE TABLE clinical.alert (
  id                 uuid PRIMARY KEY,
  treatment_id       uuid NOT NULL REFERENCES clinical.treatment (id),
  patient_id         uuid NOT NULL,
  -- the source response; WP-20 missed-response alerts and WP-21
  -- self-reports carry their own source columns instead
  survey_response_id uuid REFERENCES clinical.survey_response (id),
  severity           text NOT NULL CHECK (severity IN ('low', 'moderate', 'high')),
  status             text NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'acknowledged', 'resolved')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- the dashboard triage queue (C1) reads open alerts by severity and age
CREATE INDEX alert_triage_idx ON clinical.alert (status, severity, created_at DESC);
CREATE INDEX alert_patient_idx ON clinical.alert (patient_id, created_at DESC);

CREATE TABLE clinical.rule_trigger (
  id                 uuid PRIMARY KEY,
  -- NULL = record-only firing (all outcomes off)
  alert_id           uuid REFERENCES clinical.alert (id),
  treatment_id       uuid NOT NULL REFERENCES clinical.treatment (id),
  patient_id         uuid NOT NULL,
  survey_response_id uuid REFERENCES clinical.survey_response (id),
  -- rules version with the survey definition, so the pair
  -- (survey_version_id, rule_id) names the exact rule that fired
  survey_version_id  uuid NOT NULL REFERENCES clinical.survey_version (id),
  rule_id            text NOT NULL,
  question_id        text NOT NULL,
  severity           text CHECK (severity IN ('low', 'moderate', 'high')),
  trace              jsonb NOT NULL,
  fired_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rule_trigger_alert_idx ON clinical.rule_trigger (alert_id);
CREATE INDEX rule_trigger_response_idx ON clinical.rule_trigger (survey_response_id);
-- traces are evidence: nothing in the application may rewrite them
REVOKE UPDATE, DELETE ON clinical.rule_trigger FROM mio_app, mio_worker;

-- Same-transaction outbox: raising an alert and queueing its notification
-- either both happen or neither does. The notification layer (WP-19 bell,
-- WP-25 delivery) consumes rows in the system realm; person realms only
-- ever write. Payloads carry ids and severity - never clinical content
-- (structural guarantee 3: anything email-shaped stays contentless).
CREATE TABLE clinical.notification_outbox (
  id           uuid PRIMARY KEY,
  kind         text NOT NULL,
  treatment_id uuid REFERENCES clinical.treatment (id),
  patient_id   uuid,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX notification_outbox_pending_idx
  ON clinical.notification_outbox (created_at) WHERE processed_at IS NULL;

-- RLS. Alerts are a clinician surface: patients never read them ("the
-- patient never sees severities" - what patients get is the designed P12
-- copy). The submitting patient's transaction still INSERTS the rows the
-- evaluation produces, so the patient realm may write its own.
ALTER TABLE clinical.alert ENABLE ROW LEVEL SECURITY;
CREATE POLICY alert_read ON clinical.alert FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.alert.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY alert_write ON clinical.alert FOR INSERT
  WITH CHECK (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.alert.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
-- WP-19 workflow: acknowledge / assign / resolve, staff only
CREATE POLICY alert_update ON clinical.alert FOR UPDATE
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.alert.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );

ALTER TABLE clinical.rule_trigger ENABLE ROW LEVEL SECURITY;
CREATE POLICY rule_trigger_read ON clinical.rule_trigger FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.rule_trigger.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY rule_trigger_write ON clinical.rule_trigger FOR INSERT
  WITH CHECK (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.rule_trigger.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );

ALTER TABLE clinical.notification_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_outbox_write ON clinical.notification_outbox FOR INSERT
  WITH CHECK (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR app.current_realm() = 'staff'
  );
CREATE POLICY notification_outbox_consume ON clinical.notification_outbox FOR SELECT
  USING (app.current_realm() = 'system');
CREATE POLICY notification_outbox_mark ON clinical.notification_outbox FOR UPDATE
  USING (app.current_realm() = 'system');
