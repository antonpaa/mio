-- 0001 Foundation: schemas, roles, grants, audit tables, RLS helpers.
--
-- The structural guarantees of docs/architecture/data-model.md live here:
--   * three schemas with four NOLOGIN carrier roles;
--   * mio_admin holds NO grant on clinical.* - "administrators cannot read
--     clinical data" is a database permission error, not a policy;
--   * audit.* is INSERT-only for every application role, append-only by
--     trigger even for the owner;
--   * app.* helper functions read the transaction-scoped user context that
--     row-level-security policies key on.
--
-- Migrations always run as the database owner; ALTER DEFAULT PRIVILEGES
-- below binds to that owner, so tables created by LATER migrations inherit
-- these grants automatically.

-- Carrier roles are cluster-wide; deployments connect as login users that
-- are granted exactly one carrier and SET ROLE to it (packages/db pools).
DO $$ BEGIN CREATE ROLE mio_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE mio_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE mio_worker NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE mio_audit_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA identity;
CREATE SCHEMA clinical;
CREATE SCHEMA audit;
CREATE SCHEMA app;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Schema visibility. mio_admin gets no USAGE on clinical: the denial the
-- integration tests assert.
GRANT USAGE ON SCHEMA identity TO mio_app, mio_admin, mio_worker;
GRANT USAGE ON SCHEMA clinical TO mio_app, mio_worker;
GRANT USAGE ON SCHEMA audit TO mio_app, mio_admin, mio_worker, mio_audit_reader;
GRANT USAGE ON SCHEMA app TO mio_app, mio_admin, mio_worker, mio_audit_reader;

-- Future tables inherit these (created by the migration owner).
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT SELECT, INSERT, UPDATE ON TABLES TO mio_app, mio_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT SELECT ON TABLES TO mio_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinical
  GRANT SELECT, INSERT, UPDATE ON TABLES TO mio_app, mio_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT INSERT ON TABLES TO mio_app, mio_admin, mio_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT SELECT ON TABLES TO mio_audit_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity
  GRANT USAGE, SELECT ON SEQUENCES TO mio_app, mio_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinical
  GRANT USAGE, SELECT ON SEQUENCES TO mio_app, mio_worker;

-- Transaction-scoped user context for row-level security. Policies call
-- these; packages/db withUserContext() sets them with SET LOCAL.
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.current_realm() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.realm', true), '') $$;

-- Audit tables. Content rule (enforced by review + later lint, stated
-- here for the reader): resource references only, never clinical content.
CREATE TABLE audit.access_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_realm   text NOT NULL CHECK (actor_realm IN ('patient', 'staff', 'system')),
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   text,
  patient_id    uuid,
  decision      text NOT NULL CHECK (decision IN ('allow', 'deny')),
  context       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX access_event_patient_idx ON audit.access_event (patient_id, occurred_at DESC);
CREATE INDEX access_event_actor_idx ON audit.access_event (actor_user_id, occurred_at DESC);

CREATE TABLE audit.change_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_realm   text NOT NULL CHECK (actor_realm IN ('patient', 'staff', 'system')),
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   text,
  patient_id    uuid,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX change_event_patient_idx ON audit.change_event (patient_id, occurred_at DESC);

CREATE TABLE audit.auth_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  realm       text NOT NULL CHECK (realm IN ('patient', 'staff')),
  account_id  uuid,
  event       text NOT NULL,
  source_ip   inet,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX auth_event_account_idx ON audit.auth_event (account_id, occurred_at DESC);

-- Append-only, for everyone including the owner. Retention jobs (WP-29)
-- get a dedicated, audited path; nothing else mutates history.
CREATE FUNCTION audit.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit records are append-only'; END $$;

CREATE TRIGGER access_event_append_only
  BEFORE UPDATE OR DELETE ON audit.access_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER change_event_append_only
  BEFORE UPDATE OR DELETE ON audit.change_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER auth_event_append_only
  BEFORE UPDATE OR DELETE ON audit.auth_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER access_event_no_truncate
  BEFORE TRUNCATE ON audit.access_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER change_event_no_truncate
  BEFORE TRUNCATE ON audit.change_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER auth_event_no_truncate
  BEFORE TRUNCATE ON audit.auth_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
