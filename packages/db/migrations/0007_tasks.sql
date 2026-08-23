-- 0007 Tasks: clinician-side work items (WP-13, design C5).
--
-- A task lives on a treatment and inherits its team. NULL assignee means
-- the task sits in the TEAM QUEUE until someone claims it; completion is
-- recorded on the row and as an audit.change_event, which is the entry
-- the treatment activity log renders ("completed tasks land in the
-- treatment activity log"). No cancelled state: the capability matrix
-- defines no task.cancel, so the schema holds no unreachable status.

CREATE TABLE clinical.task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id  uuid NOT NULL REFERENCES clinical.treatment (id),
  patient_id    uuid NOT NULL,
  -- the "linked order task" of T1: a task can point at the activity it services
  activity_id   uuid REFERENCES clinical.activity (id),
  title         text NOT NULL,
  detail        text NOT NULL DEFAULT '',
  due_date      date,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  assignee_id   uuid,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_by  uuid,
  completed_at  timestamptz
);
CREATE INDEX task_assignee_idx ON clinical.task (assignee_id) WHERE status = 'open';
CREATE INDEX task_treatment_idx ON clinical.task (treatment_id) WHERE status = 'open';
CREATE INDEX task_due_idx ON clinical.task (due_date) WHERE status = 'open';

-- Backstop only - Cedar decides per the matrix (task.view: team_member).
-- The RLS net is patient-level (care relationship), deliberately one notch
-- wider than the treatment-team scoping the queries and policies apply.
ALTER TABLE clinical.task ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_read ON clinical.task FOR SELECT
  USING (
    app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.task.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );
CREATE POLICY task_write ON clinical.task FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');
CREATE POLICY task_update ON clinical.task FOR UPDATE
  USING (
    app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.task.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );
