import type pg from 'pg';
import { writeChangeEvent } from '@mio/db';
import type { ObjectStorage } from '@mio/storage';

/**
 * WP-29: the two retention jobs.
 *
 * ARCHIVE: a treatment that has sat completed or discontinued through
 * its quiet period gains archived_at - the read-only marker the
 * retention policy speaks about. Nothing is deleted; deletion waits for
 * the statutory periods (compliance register R5), and until they land
 * every class in audit.retention_policy carries a NULL period, which
 * means HOLD.
 *
 * AUDIT EXPORT: whole days of audit events copied to object storage as
 * JSONL, one file per table per day, through the mio_audit_reader
 * carrier (the worker role stays INSERT-only on audit.*). The watermark
 * makes the job idempotent: a day is either fully exported and behind
 * the watermark, or it will be picked up again. Bucket-level
 * immutability is the deployment's contribution (infra).
 */

const QUIET_PERIOD_DAYS = 90;
const AUDIT_TABLES = ['access_event', 'change_event', 'auth_event'] as const;
const EXPORT_JOB = 'audit-export';
/** bound a backlog run; the next run continues where this one stopped */
const MAX_DAYS_PER_RUN = 31;

export async function archiveSettledTreatments(pool: {
  connect(): Promise<pg.PoolClient>;
}): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.realm', 'system', true)`,
    );
    const { rows } = await client.query<{ id: string; patient_id: string }>(
      `UPDATE clinical.treatment
          SET archived_at = now()
        WHERE state IN ('completed', 'discontinued')
          AND archived_at IS NULL
          AND state_changed_at < now() - make_interval(days => $1)
        RETURNING id, patient_id`,
      [QUIET_PERIOD_DAYS],
    );
    for (const row of rows) {
      await writeChangeEvent(client, {
        actorUserId: null,
        actorRealm: 'system',
        action: 'treatment.archive',
        resourceType: 'treatment',
        resourceId: row.id,
        patientId: row.patient_id,
      });
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface AuditExportResult {
  days: number;
  events: number;
}

export async function exportAuditDays(
  workerPool: pg.Pool,
  auditReader: pg.Pool,
  storage: ObjectStorage,
  today = new Date().toISOString().slice(0, 10),
): Promise<AuditExportResult> {
  // exclusive upper bound: today is still being written to
  const { rows: markRows } = await workerPool.query<{ exported_through: string }>(
    `SELECT exported_through::text AS exported_through
       FROM audit.export_watermark WHERE job = $1`,
    [EXPORT_JOB],
  );
  let through = markRows[0]?.exported_through;
  if (through === undefined) {
    // first run: begin the day before the earliest event, so the loop
    // below exports everything that exists
    const { rows: firstRows } = await auditReader.query<{ first: string | null }>(
      `SELECT min(occurred_at)::date::text AS first FROM audit.access_event`,
    );
    const first = firstRows[0]?.first;
    through = first ? previousDay(first) : previousDay(today);
    await workerPool.query(
      `INSERT INTO audit.export_watermark (job, exported_through) VALUES ($1, $2)
       ON CONFLICT (job) DO NOTHING`,
      [EXPORT_JOB, through],
    );
  }

  const result: AuditExportResult = { days: 0, events: 0 };
  while (result.days < MAX_DAYS_PER_RUN) {
    const day = nextDay(through);
    if (day >= today) break;
    for (const table of AUDIT_TABLES) {
      const { rows } = await auditReader.query(
        `SELECT to_jsonb(t) AS event FROM audit.${table} t
          WHERE t.occurred_at >= $1::date AND t.occurred_at < $1::date + 1
          ORDER BY t.occurred_at, t.id`,
        [day],
      );
      if (rows.length === 0) continue;
      const lines = (rows as { event: object }[])
        .map((row) => JSON.stringify(row.event))
        .join('\n');
      await storage.put(
        `audit-exports/${table}/${day}.jsonl`,
        new TextEncoder().encode(`${lines}\n`),
        'application/x-ndjson',
      );
      result.events += rows.length;
    }
    await workerPool.query(
      `UPDATE audit.export_watermark SET exported_through = $2, updated_at = now()
        WHERE job = $1`,
      [EXPORT_JOB, day],
    );
    through = day;
    result.days += 1;
  }
  return result;
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
