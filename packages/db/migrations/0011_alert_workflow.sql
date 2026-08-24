-- 0011 Alert workflow (WP-19): new -> acknowledged -> resolved with
-- assignment and comments (docs/architecture/surveys-and-alerts.md).
-- The PP6 history timeline is assembled from THESE columns and the
-- comment rows - all workflow state lives in clinical tables the staff
-- realm may read; the audit schema stays write-only for the app.

ALTER TABLE clinical.alert
  ADD COLUMN assignee_id     uuid,
  ADD COLUMN assigned_at     timestamptz,
  ADD COLUMN assigned_by     uuid,
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledged_by uuid,
  ADD COLUMN resolved_at     timestamptz,
  ADD COLUMN resolved_by     uuid;

-- Comments are part of the audited history: append-only, never edited,
-- never deleted - like the trigger traces they sit beside.
CREATE TABLE clinical.alert_comment (
  id         uuid PRIMARY KEY,
  alert_id   uuid NOT NULL REFERENCES clinical.alert (id),
  patient_id uuid NOT NULL,
  author_id  uuid NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_comment_alert_idx ON clinical.alert_comment (alert_id, created_at);
REVOKE UPDATE, DELETE ON clinical.alert_comment FROM mio_app, mio_worker;

ALTER TABLE clinical.alert_comment ENABLE ROW LEVEL SECURITY;
CREATE POLICY alert_comment_read ON clinical.alert_comment FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.alert_comment.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY alert_comment_write ON clinical.alert_comment FOR INSERT
  WITH CHECK (
    app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.alert_comment.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );
