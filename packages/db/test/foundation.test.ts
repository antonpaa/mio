import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRolePool, migrate, withUserContext, writeAccessEvent } from '../src/index.js';
import { provisionTestDatabase, type TestDatabase } from './test-db.js';

/**
 * These tests ARE the structural guarantees of ADR-0007: they prove the
 * grants, not the intention. If one of them fails, the architecture's
 * central promise is broken.
 */

let db: TestDatabase;
let owner: pg.Pool;

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';

async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: '42501' });
}

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  // A probe table in clinical, created BY THE MIGRATION OWNER exactly like a
  // later migration would create real tables - so what we assert about it
  // (inherited grants, RLS mechanics) holds for every future clinical table.
  await owner.query(`
    CREATE TABLE IF NOT EXISTS clinical.rls_probe (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_user_id uuid NOT NULL,
      note text NOT NULL
    )
  `);
  await owner.query('ALTER TABLE clinical.rls_probe ENABLE ROW LEVEL SECURITY');
  await owner.query(`
    DO $$ BEGIN
      CREATE POLICY rls_probe_self ON clinical.rls_probe
        USING (patient_user_id = app.current_user_id())
        WITH CHECK (patient_user_id = app.current_user_id());
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await owner.query(`
    CREATE TABLE IF NOT EXISTS identity.grants_probe (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      label text NOT NULL
    )
  `);
  // The database may persist across runs (MIO_TEST_DATABASE_URL); probe
  // tables start empty. Audit tables are append-only by design, so their
  // assertions never depend on counts.
  await owner.query('DELETE FROM clinical.rls_probe');
  await owner.query('DELETE FROM identity.grants_probe');
});

afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

describe('migration runner', () => {
  it('is idempotent: a second run applies nothing', async () => {
    const second = await migrate(db.connectionString);
    expect(second.applied).toHaveLength(0);
    expect(second.alreadyApplied).toBeGreaterThan(0);
  });

  it('refuses an edited applied migration (history is immutable)', async () => {
    await owner.query(
      "UPDATE public.schema_migrations SET checksum = 'tampered' WHERE version = 1",
    );
    await expect(migrate(db.connectionString)).rejects.toThrow(/edited after being applied/);
    // restore the real checksum for the remaining tests
    const { loadMigrations } = await import('../src/migrate.js');
    const migrations = await loadMigrations();
    const first = migrations[0];
    if (!first) throw new Error('no migrations on disk');
    await owner.query('UPDATE public.schema_migrations SET checksum = $1 WHERE version = 1', [
      first.checksum,
    ]);
  });
});

describe('the administrator wall (ADR-0007)', () => {
  it('mio_admin cannot touch clinical.* at all - no schema usage', async () => {
    const admin = createRolePool({
      connectionString: db.connectionString,
      role: 'mio_admin',
      max: 1,
    });
    try {
      expect((await admin.query('SELECT current_user')).rows[0].current_user).toBe('mio_admin');
      await expectPermissionDenied(admin.query('SELECT * FROM clinical.rls_probe'));
      await expectPermissionDenied(
        admin.query("INSERT INTO clinical.rls_probe (patient_user_id, note) VALUES ($1, 'x')", [
          USER_A,
        ]),
      );
      // while identity remains fully administrable
      await admin.query("INSERT INTO identity.grants_probe (label) VALUES ('admin-can')");
      const { rows } = await admin.query('SELECT count(*)::int AS n FROM identity.grants_probe');
      expect(rows[0].n).toBeGreaterThan(0);
    } finally {
      await admin.end();
    }
  });

  it('mio_app reads identity and clinical, but cannot read audit', async () => {
    const app = createRolePool({ connectionString: db.connectionString, role: 'mio_app', max: 1 });
    try {
      await app.query('SELECT count(*) FROM identity.grants_probe');
      await expectPermissionDenied(app.query('SELECT count(*) FROM audit.access_event'));
    } finally {
      await app.end();
    }
  });

  it('mio_audit_reader reads audit and nothing else', async () => {
    const reader = createRolePool({
      connectionString: db.connectionString,
      role: 'mio_audit_reader',
      max: 1,
    });
    try {
      await reader.query('SELECT count(*) FROM audit.access_event');
      await expectPermissionDenied(reader.query('SELECT count(*) FROM identity.grants_probe'));
      await expectPermissionDenied(reader.query('SELECT count(*) FROM clinical.rls_probe'));
    } finally {
      await reader.end();
    }
  });
});

describe('audit is append-only', () => {
  it('app role inserts; nobody updates, deletes or truncates - not even the owner', async () => {
    const app = createRolePool({ connectionString: db.connectionString, role: 'mio_app', max: 1 });
    try {
      await app.query(
        `INSERT INTO audit.access_event (actor_user_id, actor_realm, action, resource_type, resource_id, patient_id, decision)
         VALUES ($1, 'staff', 'view', 'rls_probe', 'probe-1', $2, 'allow')`,
        [USER_A, USER_B],
      );
      await expectPermissionDenied(app.query("UPDATE audit.access_event SET action = 'rewritten'"));
      await expectPermissionDenied(app.query('DELETE FROM audit.access_event'));
    } finally {
      await app.end();
    }
    // The owner holds full table privileges - the trigger is the backstop.
    await expect(owner.query("UPDATE audit.access_event SET action = 'rewritten'")).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.query('DELETE FROM audit.access_event')).rejects.toThrow(/append-only/);
    await expect(owner.query('TRUNCATE audit.access_event')).rejects.toThrow(/append-only/);
  });
});

describe('the same-transaction audit hook', () => {
  it('writes an access event on the caller transaction under the app role', async () => {
    const app = createRolePool({ connectionString: db.connectionString, role: 'mio_app', max: 1 });
    try {
      const id = await withUserContext(app, { userId: USER_A, realm: 'staff' }, (client) =>
        writeAccessEvent(client, {
          actorUserId: USER_A,
          actorRealm: 'staff',
          action: 'patient_clinical_profile.view',
          resourceType: 'patient_clinical_profile',
          resourceId: 'profile-1',
          patientId: USER_B,
          decision: 'deny',
        }),
      );
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await app.end();
    }
  });
});

describe('row-level security via transaction-scoped context', () => {
  it('a user sees exactly their rows; no context sees nothing; context dies with the transaction', async () => {
    const app = createRolePool({ connectionString: db.connectionString, role: 'mio_app', max: 1 });
    try {
      await withUserContext(app, { userId: USER_A, realm: 'patient' }, async (client) => {
        await client.query(
          "INSERT INTO clinical.rls_probe (patient_user_id, note) VALUES ($1, 'a')",
          [USER_A],
        );
      });
      await withUserContext(app, { userId: USER_B, realm: 'patient' }, async (client) => {
        await client.query(
          "INSERT INTO clinical.rls_probe (patient_user_id, note) VALUES ($1, 'b')",
          [USER_B],
        );
      });

      const aRows = await withUserContext(app, { userId: USER_A, realm: 'patient' }, (client) =>
        client.query('SELECT note FROM clinical.rls_probe').then((r) => r.rows),
      );
      expect(aRows).toEqual([{ note: 'a' }]);

      // Same pool, same physical connection (max: 1), AFTER the context
      // transaction ended: SET LOCAL must have died with the transaction.
      const bare = await app.query('SELECT count(*)::int AS n FROM clinical.rls_probe');
      expect(bare.rows[0].n).toBe(0);

      // And a user cannot write a row that is not theirs.
      await expect(
        withUserContext(app, { userId: USER_A, realm: 'patient' }, (client) =>
          client.query(
            "INSERT INTO clinical.rls_probe (patient_user_id, note) VALUES ($1, 'forged')",
            [USER_B],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }

    // The owner bypasses RLS (table owner, no FORCE) - which is why owner
    // connections are for migrations and tests, never application traffic.
    const all = await owner.query('SELECT count(*)::int AS n FROM clinical.rls_probe');
    expect(all.rows[0].n).toBe(2);
  });
});
