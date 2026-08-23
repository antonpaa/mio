-- 0004 Care relationships: the pivot of the authorization model
-- (docs/architecture/authorization.md). Derived from team membership x
-- enrolment once treatments exist (WP-11 populates and maintains it);
-- time-bounded so "did this person have access THAT day" stays answerable.

CREATE TABLE clinical.care_relationship (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL,
  staff_id     uuid NOT NULL,
  -- The treatment that grants the relationship; nullable until WP-11 wires
  -- real treatments, after which every new row carries its source.
  treatment_id uuid,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
CREATE INDEX care_relationship_staff_idx
  ON clinical.care_relationship (staff_id) WHERE ended_at IS NULL;
CREATE INDEX care_relationship_patient_idx
  ON clinical.care_relationship (patient_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX care_relationship_live_idx
  ON clinical.care_relationship (patient_id, staff_id, coalesce(treatment_id, '00000000-0000-0000-0000-000000000000'))
  WHERE ended_at IS NULL;

-- RLS backstop beneath Cedar (ADR-0007): patients reach only their own
-- rows, staff only rows naming them. The application scopes in SQL anyway;
-- this is the wall a missing WHERE clause hits.
ALTER TABLE clinical.care_relationship ENABLE ROW LEVEL SECURITY;
CREATE POLICY care_relationship_self ON clinical.care_relationship
  USING (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND staff_id = app.current_user_id())
  )
  WITH CHECK (app.current_realm() = 'staff' AND staff_id IS NOT NULL);

-- The sanctioned slice-builder (docs/architecture/authorization.md): Cedar
-- needs the FULL care team of a patient to decide, while RLS rightly shows
-- a staff member only their own relationship rows. SECURITY DEFINER runs
-- as the migration owner (RLS-exempt), does exactly one thing, and is the
-- only broad read path into the care graph.
CREATE FUNCTION app.care_team_of(target_patient uuid) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = clinical, pg_temp
  AS $$
    SELECT coalesce(array_agg(staff_id), '{}')
    FROM clinical.care_relationship
    WHERE patient_id = target_patient AND ended_at IS NULL
  $$;
REVOKE ALL ON FUNCTION app.care_team_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.care_team_of(uuid) TO mio_app, mio_worker;
