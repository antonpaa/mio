-- WP-29: retention and offboarding, kept simple per the brief.
--
-- Deceased patients are a DATE on the account, set by a treatment lead
-- through an audited care-side action: sign-in is closed, every piece
-- of outbound automation checks the flag, and the record is retained.
-- Completed treatments gain an archived_at the worker stamps after a
-- quiet period. The retention classes live in one table whose periods
-- are NULL until the statutory input arrives (compliance register R5) -
-- a NULL period means hold, never delete; nothing in the system deletes
-- on its own while the legal question is open.

ALTER TABLE identity.patient_account ADD COLUMN deceased_on date;

ALTER TABLE clinical.treatment ADD COLUMN archived_at timestamptz;

-- the archival job is the first system-realm actor on treatments; the
-- original policies (0005) only knew patients and staff, and exactly
-- these two verbs are what the sweep needs
CREATE POLICY treatment_read_system ON clinical.treatment FOR SELECT
  USING (app.current_realm() = 'system');
CREATE POLICY treatment_update_system ON clinical.treatment FOR UPDATE
  USING (app.current_realm() = 'system');

CREATE TABLE audit.retention_policy (
  class            text PRIMARY KEY,
  description      text NOT NULL,
  statutory_basis  text NOT NULL DEFAULT 'R5 pending — statutory input not yet provided',
  period_months    integer,  -- NULL = hold indefinitely until R5 lands
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO audit.retention_policy (class, description) VALUES
  ('clinical_record',  'Treatments, survey responses, observations, messages — retained read-only after archive'),
  ('attachment',       'Patient-uploaded files — retained with their treatment'),
  ('audit_record',     'Access and change events — exported to immutable storage, statutory minimum applies'),
  ('identity_account', 'Accounts — credentials void on deactivation, identity retained'),
  ('deceased_record',  'A deceased patient''s data — retained as long as legally required, handled respectfully');

-- the policy table is configuration, edited by migrations only
REVOKE INSERT ON audit.retention_policy FROM mio_app, mio_admin, mio_worker;
GRANT SELECT ON audit.retention_policy TO mio_app, mio_worker;

-- the immutable-storage export keeps a per-job bookmark so re-runs are
-- idempotent and gaps are impossible: a day is either fully exported
-- and past the watermark, or it is not
CREATE TABLE audit.export_watermark (
  job              text PRIMARY KEY,
  exported_through date NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
REVOKE INSERT ON audit.export_watermark FROM mio_app, mio_admin;
GRANT SELECT, INSERT, UPDATE ON audit.export_watermark TO mio_worker;

-- the export job reads the audit tables through the mio_audit_reader
-- carrier, which already holds SELECT via the schema defaults
