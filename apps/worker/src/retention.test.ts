import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRolePool, migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { createFsStorage } from '@mio/storage';
import { archiveSettledTreatments, exportAuditDays } from './retention.js';

/**
 * WP-29: the archival stamp respects the quiet period and re-runs are
 * no-ops; the audit export writes whole days as JSONL and the watermark
 * makes a second run a no-op. Real Postgres, real carrier roles.
 */

let db: TestDatabase;
let owner: pg.Pool;
let worker: pg.Pool;
let auditReader: pg.Pool;
let root: string;

const PATIENT = '70617469-0000-4000-8000-00000000dead';
const OLD_TREATMENT = '74726561-0000-4000-8000-000000000001';
const FRESH_TREATMENT = '74726561-0000-4000-8000-000000000002';

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  worker = createRolePool({ connectionString: db.connectionString, role: 'mio_worker' });
  auditReader = createRolePool({ connectionString: db.connectionString, role: 'mio_audit_reader' });
  root = await mkdtemp(join(tmpdir(), 'mio-retention-'));

  // the scratch database persists between runs (MIO_TEST_DATABASE_URL):
  // fixture writes are idempotent, and the export watermark is cleared
  // so the export test always has un-exported days in front of it
  await owner.query(
    `INSERT INTO identity.patient_account (id, email, given_name, family_name)
     VALUES ($1, 'retention.fixture@patient.example', 'Retention', 'Fixture')
     ON CONFLICT (id) DO NOTHING`,
    [PATIENT],
  );
  await owner.query(
    `INSERT INTO clinical.treatment
       (id, patient_id, name, state, created_by, state_changed_at)
     VALUES
       ($1, $3, 'Settled programme', 'completed', gen_random_uuid(), now() - interval '120 days'),
       ($2, $3, 'Recently completed', 'completed', gen_random_uuid(), now() - interval '5 days')
     ON CONFLICT (id) DO UPDATE
       SET archived_at = NULL, state = 'completed',
           state_changed_at = EXCLUDED.state_changed_at`,
    [OLD_TREATMENT, FRESH_TREATMENT, PATIENT],
  );
  await owner.query(
    `INSERT INTO audit.access_event
       (occurred_at, actor_realm, action, resource_type, patient_id, decision)
     VALUES
       (now() - interval '2 days', 'staff', 'patient_clinical_profile.view',
        'patient_clinical_profile', $1, 'allow'),
       (now() - interval '2 days', 'staff', 'survey_response.view',
        'survey_response', $1, 'allow')`,
    [PATIENT],
  );
  await owner.query(`DELETE FROM audit.export_watermark WHERE job = 'audit-export'`);
});

afterAll(async () => {
  await owner?.end();
  await worker?.end();
  await auditReader?.end();
  await db?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('treatment archival', () => {
  it('stamps only treatments past the quiet period, once', async () => {
    const countEvents = async (): Promise<number> =>
      (
        await owner.query(
          `SELECT count(*)::int AS n FROM audit.change_event WHERE action = 'treatment.archive'`,
        )
      ).rows[0].n as number;
    const before = await countEvents();

    expect(await archiveSettledTreatments(worker)).toBe(1);
    const { rows } = await owner.query(
      `SELECT id, archived_at FROM clinical.treatment WHERE id = ANY($1) ORDER BY id`,
      [[OLD_TREATMENT, FRESH_TREATMENT]],
    );
    const byId = new Map(
      (rows as { id: string; archived_at: Date | null }[]).map((row) => [row.id, row.archived_at]),
    );
    expect(byId.get(OLD_TREATMENT)).not.toBeNull();
    expect(byId.get(FRESH_TREATMENT)).toBeNull();

    // the change event names the archival; a re-run is a no-op
    expect(await countEvents()).toBe(before + 1);
    expect(await archiveSettledTreatments(worker)).toBe(0);
  });
});

describe('audit export to object storage', () => {
  it('writes whole days as JSONL behind a watermark; a re-run is a no-op', async () => {
    const storage = createFsStorage(root);
    const first = await exportAuditDays(worker, auditReader, storage);
    expect(first.days).toBeGreaterThan(0);
    expect(first.events).toBeGreaterThanOrEqual(2);

    const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const file = await readFile(
      join(root, 'audit-exports', 'access_event', `${day}.jsonl`),
      'utf8',
    );
    const lines = file
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { action: string });
    // >= because audit rows accumulate across reruns on the shared cluster
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.map((line) => line.action)).toContain('survey_response.view');

    const again = await exportAuditDays(worker, auditReader, storage);
    expect(again).toEqual({ days: 0, events: 0 });
  });
});
