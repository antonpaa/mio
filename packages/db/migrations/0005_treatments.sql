-- 0005 Treatments: templates with versioning, staff teams, per-patient
-- treatments with lifecycle, the treatment care team, and the wiring that
-- keeps clinical.care_relationship derived from it (WP-11).
--
-- Model note (docs/architecture/data-model.md calls its sketch a sketch):
-- the designed catalog (T2) INSTANTIATES A COPY of a template for one
-- patient - so a treatment row belongs to exactly one patient and there is
-- no separate enrolment join table; "enrolment" is the act of creating the
-- treatment. Surveys' many-to-many attachment arrives with WP-14/17.

-- Staff teams are ORG structure, not clinical data (capability matrix puts
-- resource `team` in the identity schema).
CREATE TABLE identity.team (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.team_membership (
  team_id  uuid NOT NULL REFERENCES identity.team (id),
  staff_id uuid NOT NULL REFERENCES identity.staff_account (id),
  PRIMARY KEY (team_id, staff_id)
);

CREATE TABLE clinical.treatment_template (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  detail     text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Published versions are immutable; editing one creates the next. Running
-- treatments keep the version they started with (T2).
CREATE TABLE clinical.treatment_template_version (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES clinical.treatment_template (id),
  version      integer NOT NULL,
  state        text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
  -- Structured plan: activity blueprints, later survey attachments (WP-12+).
  definition   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (template_id, version)
);

CREATE TABLE clinical.treatment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL,
  template_version_id uuid REFERENCES clinical.treatment_template_version (id),
  name                text NOT NULL,
  detail              text NOT NULL DEFAULT '',
  state               text NOT NULL DEFAULT 'draft'
                      CHECK (state IN ('draft', 'active', 'paused', 'completed', 'discontinued')),
  modified_from_template boolean NOT NULL DEFAULT false,
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  state_changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX treatment_patient_idx ON clinical.treatment (patient_id);

-- The treatment's care team: individual members AND attached staff teams
-- (PP1: "Team: Urology outpatient - 8 members"). Exactly one of
-- staff_id/team_id per row; role applies to individuals (an attached
-- group's members join as members, never leads).
CREATE TABLE clinical.treatment_care_team (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES clinical.treatment (id),
  staff_id     uuid,
  team_id      uuid,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'lead')),
  added_by     uuid NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  CHECK ((staff_id IS NULL) <> (team_id IS NULL)),
  CHECK (team_id IS NULL OR role = 'member')
);
CREATE INDEX treatment_care_team_treatment_idx
  ON clinical.treatment_care_team (treatment_id) WHERE removed_at IS NULL;

-- Effective individual membership of a treatment's team, groups resolved.
CREATE FUNCTION app.treatment_staff(target_treatment uuid)
  RETURNS TABLE (staff_id uuid, is_lead boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = clinical, identity, pg_temp
  AS $$
    -- Outer aggregate on purpose: a lead who is ALSO in an attached group
    -- appears in both arms with different is_lead - one row must win.
    SELECT u.staff_id, bool_or(u.is_lead) AS is_lead FROM (
      SELECT ct.staff_id, (ct.role = 'lead') AS is_lead
        FROM clinical.treatment_care_team ct
       WHERE ct.treatment_id = target_treatment AND ct.removed_at IS NULL AND ct.staff_id IS NOT NULL
      UNION ALL
      SELECT tm.staff_id, false
        FROM clinical.treatment_care_team ct
        JOIN identity.team_membership tm ON tm.team_id = ct.team_id
       WHERE ct.treatment_id = target_treatment AND ct.removed_at IS NULL AND ct.team_id IS NOT NULL
    ) u
    GROUP BY u.staff_id
  $$;
REVOKE ALL ON FUNCTION app.treatment_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.treatment_staff(uuid) TO mio_app, mio_worker;

-- Rebuild the materialised care graph for one treatment: end rows whose
-- backing membership is gone, start rows for new members. Time-bounded -
-- ended rows stay for "who had access when". Lifecycle does not end
-- relationships in v1 (a completed treatment's team keeps read access;
-- docs/architecture/data-model.md retention).
CREATE FUNCTION app.sync_care_relationships(target_treatment uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = clinical, identity, pg_temp
  AS $$
DECLARE
  target_patient uuid;
BEGIN
  SELECT patient_id INTO target_patient FROM clinical.treatment WHERE id = target_treatment;
  IF target_patient IS NULL THEN RETURN; END IF;

  UPDATE clinical.care_relationship cr
     SET ended_at = now()
   WHERE cr.treatment_id = target_treatment AND cr.ended_at IS NULL
     AND cr.staff_id NOT IN (SELECT ts.staff_id FROM app.treatment_staff(target_treatment) ts);

  INSERT INTO clinical.care_relationship (patient_id, staff_id, treatment_id)
  SELECT target_patient, ts.staff_id, target_treatment
    FROM app.treatment_staff(target_treatment) ts
   WHERE NOT EXISTS (
     SELECT 1 FROM clinical.care_relationship cr
      WHERE cr.treatment_id = target_treatment AND cr.staff_id = ts.staff_id AND cr.ended_at IS NULL
   );
END;
$$;
REVOKE ALL ON FUNCTION app.sync_care_relationships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sync_care_relationships(uuid) TO mio_app, mio_worker;

-- RLS backstop on the treatment root (ADR-0007): patients their own rows;
-- staff rows only where a live care relationship exists (the inner query
-- is itself RLS-scoped to the caller's own relationship rows, which is
-- exactly the question being asked). Writes are staff-realm only; the
-- creating INSERT precedes the care-team row, so INSERT checks realm, not
-- relationship.
ALTER TABLE clinical.treatment ENABLE ROW LEVEL SECURITY;
CREATE POLICY treatment_read ON clinical.treatment FOR SELECT
  USING (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.treatment.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY treatment_insert ON clinical.treatment FOR INSERT
  WITH CHECK (app.current_realm() = 'staff');
CREATE POLICY treatment_update ON clinical.treatment FOR UPDATE
  USING (
    app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.treatment.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );
