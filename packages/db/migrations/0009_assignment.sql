-- 0009 Survey assignment (WP-17, design T4/P3): occurrences carry the
-- survey they collect, missed is a real state, and one occurrence takes
-- exactly one response.

-- 'missed': the answer window closed with no submission. Distinct from
-- 'cancelled' (a human called it off) - the missed-response rules (WP-20)
-- run over exactly this state.
ALTER TABLE clinical.activity DROP CONSTRAINT activity_status_check;
ALTER TABLE clinical.activity ADD CONSTRAINT activity_status_check
  CHECK (status IN ('planned', 'confirmed', 'completed', 'cancelled', 'missed'));

-- Which survey a SEND-NOW occurrence collects; scheduled occurrences
-- resolve via their schedule's survey instead (one source of truth per
-- path, COALESCE at read time).
ALTER TABLE clinical.activity ADD COLUMN survey_id uuid REFERENCES clinical.survey (id);
ALTER TABLE clinical.schedule ADD COLUMN survey_id uuid REFERENCES clinical.survey (id);

-- T4's language choice: NULL = "patient's choice" (their account locale).
ALTER TABLE clinical.treatment_survey ADD COLUMN language text;

-- One reminder per occurrence: the send is recorded ON the occurrence
-- (the audit schema is INSERT-only for the worker, so it cannot be the
-- dedupe source).
ALTER TABLE clinical.activity ADD COLUMN reminded_at timestamptz;

-- An occurrence takes at most one response.
CREATE UNIQUE INDEX survey_response_activity_idx
  ON clinical.survey_response (activity_id) WHERE activity_id IS NOT NULL;

-- The worker's sweep scans open survey occurrences by date.
CREATE INDEX activity_survey_sweep_idx
  ON clinical.activity (occurrence_date)
  WHERE kind = 'survey' AND status IN ('planned', 'confirmed');

-- The worker is the SYSTEM actor: it holds no personal care relationship,
-- so none of the person-scoped policies above can ever match it (this
-- also fixes the WP-12 horizon job, which relied on the staff-realm
-- policies and would have seen nothing as mio_worker). Its context sets
-- app.realm = 'system', and these policies grant exactly the verbs its
-- jobs need - nothing person-facing runs in this realm.
CREATE POLICY schedule_read_system ON clinical.schedule FOR SELECT
  USING (app.current_realm() = 'system');
CREATE POLICY schedule_update_system ON clinical.schedule FOR UPDATE
  USING (app.current_realm() = 'system');
CREATE POLICY activity_read_system ON clinical.activity FOR SELECT
  USING (app.current_realm() = 'system');
CREATE POLICY activity_write_system ON clinical.activity FOR INSERT
  WITH CHECK (app.current_realm() = 'system');
CREATE POLICY activity_update_system ON clinical.activity FOR UPDATE
  USING (app.current_realm() = 'system');
CREATE POLICY survey_response_read_system ON clinical.survey_response FOR SELECT
  USING (app.current_realm() = 'system');

-- Submitting an occurrence-bound response completes its occurrence. The
-- patient realm has no UPDATE on clinical.activity (RLS: staff only), so
-- the completion runs through a SECURITY DEFINER helper that is
-- self-guarding: it only fires when a SUBMITTED response actually
-- references the occurrence.
CREATE FUNCTION app.complete_survey_occurrence(occurrence uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = clinical, pg_temp AS $$
  UPDATE clinical.activity
     SET status = 'completed', status_changed_at = now()
   WHERE id = occurrence AND kind = 'survey'
     AND status IN ('planned', 'confirmed')
     AND EXISTS (
       SELECT 1 FROM clinical.survey_response r
        WHERE r.activity_id = occurrence AND r.status = 'submitted'
     );
$$;
REVOKE ALL ON FUNCTION app.complete_survey_occurrence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.complete_survey_occurrence(uuid) TO mio_app;
