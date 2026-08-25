-- 0021 Role restructure (decided 2026-08-25): an account HOLDS roles, it
-- is not one. Three findings drove this:
--   * one person can legitimately be several things (an administrator who
--     also practises), so roles live in a join table and grants union;
--   * "treatment lead" was never a platform-wide identity - it is a
--     position on one treatment's care team (clinical.treatment_care_team
--     role='lead'), and modelling it as an account role granted lead
--     power over EVERY treatment: an information-security hazard;
--   * authoring templates/taxonomy is its own capability ('author'),
--     no longer implied by seniority.
-- The old single-role column maps: treatment_member -> clinician,
-- treatment_lead -> clinician + author (leads authored under the old
-- model; pruning is a deliberate, audited A1 act, never a silent side
-- effect of a migration), administrator and auditor carry over.

CREATE TABLE identity.staff_account_role (
  account_id uuid NOT NULL REFERENCES identity.staff_account (id) ON DELETE CASCADE,
  role       text NOT NULL
             CHECK (role IN ('clinician', 'author', 'administrator', 'auditor')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, role)
);

-- Auditor is EXCLUSIVE by rule (segregation of duties: the overseer holds
-- no operational capability, and nobody operational reads the full audit
-- log). The application validates this too; the trigger makes the
-- database itself refuse the combination.
CREATE FUNCTION identity.enforce_auditor_exclusivity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM identity.staff_account_role
    WHERE account_id = NEW.account_id AND role <> NEW.role
      AND ('auditor' IN (role, NEW.role))
  ) THEN
    RAISE EXCEPTION 'auditor is an exclusive role (account %)', NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_account_role_auditor_exclusive
  BEFORE INSERT OR UPDATE ON identity.staff_account_role
  FOR EACH ROW EXECUTE FUNCTION identity.enforce_auditor_exclusivity();

INSERT INTO identity.staff_account_role (account_id, role)
SELECT id,
       CASE role
         WHEN 'treatment_member' THEN 'clinician'
         WHEN 'treatment_lead'   THEN 'clinician'
         ELSE role
       END
FROM identity.staff_account;

INSERT INTO identity.staff_account_role (account_id, role)
SELECT id, 'author' FROM identity.staff_account WHERE role = 'treatment_lead';

-- The single-role column goes: two sources of truth for authorization is
-- exactly the bug class this system exists to not have.
ALTER TABLE identity.staff_account DROP COLUMN role;

-- Default privileges (0001) cover SELECT/INSERT/UPDATE; revoking a role
-- from an account is a DELETE, same as team membership (0018).
GRANT DELETE ON identity.staff_account_role TO mio_app;
