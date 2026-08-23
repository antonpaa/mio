import { PgBoss } from 'pg-boss';
import type pg from 'pg';

/**
 * The job bus (ADR-0008): pg-boss over the pgboss schema, routed through a
 * role-carrying pool so every queue operation runs under the caller's
 * carrier role. The worker role owns and migrates the schema; the app role
 * only enqueues - it lacks (and must lack) the DDL privileges.
 *
 * Enqueueing inside a domain transaction (the transactional outbox) uses
 * sendInTransaction() with the caller's open client, so "alert raised" and
 * "notification queued" commit or roll back together.
 */

export const QUEUES = {
  /** Smoke queue proving the bus end to end; real queues arrive per WP. */
  heartbeat: 'heartbeat',
  /** Daily rolling-horizon extension of materialised schedules (WP-12). */
  scheduleExtend: 'schedule-extend',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * The pgboss schema version our migrations install (0002_pgboss.sql).
 * A pg-boss upgrade that changes its schema bumps this constant and adds a
 * migration generated with getMigrationPlans() - in the same PR.
 */
export const EXPECTED_PGBOSS_VERSION = 37;

export interface JobBusOptions {
  /** A pool from createRolePool - mio_worker for consumers, mio_app for producers. */
  pool: pg.Pool;
}

export async function createJobBus(options: JobBusOptions): Promise<PgBoss> {
  // The schema is installed by OUR migrations, never by pg-boss: neither
  // role holds the DDL privileges, deliberately. Fail loud and early if the
  // database and the library disagree about the schema version.
  const { rows } = await options.pool.query<{ version: number }>(
    'SELECT version FROM pgboss.version',
  );
  const installed = rows[0]?.version;
  if (Number(installed) !== EXPECTED_PGBOSS_VERSION) {
    throw new Error(
      `pgboss schema version ${String(installed)} does not match the expected ` +
        `${EXPECTED_PGBOSS_VERSION} - run migrations (and see 0002_pgboss.sql's header ` +
        'for the pg-boss upgrade procedure)',
    );
  }

  const boss = new PgBoss({
    db: {
      executeSql: async (text, values) => options.pool.query(text, values),
    },
    schema: 'pgboss',
    migrate: false,
  });
  boss.on('error', (error) => {
    console.error(JSON.stringify({ level: 'error', src: 'pg-boss', msg: String(error) }));
  });
  await boss.start();
  return boss;
}

/**
 * Enqueue within the caller's open transaction. The job becomes visible to
 * consumers only when that transaction commits; if it rolls back, the job
 * never existed - the outbox property ADR-0008 exists for.
 */
export async function sendInTransaction(
  boss: PgBoss,
  client: pg.ClientBase,
  queue: QueueName,
  data: object,
): Promise<string | null> {
  return boss.send(queue, data, {
    db: { executeSql: async (text, values) => client.query(text, values) },
  });
}
