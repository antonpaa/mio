import type { PgBoss } from 'pg-boss';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobBus, createRolePool, migrate, QUEUES, sendInTransaction } from '../src/index.js';
import { provisionTestDatabase, type TestDatabase } from './test-db.js';

let db: TestDatabase;
let workerPool: pg.Pool;
let appPool: pg.Pool;
let workerBus: PgBoss;
let appBus: PgBoss;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  workerPool = createRolePool({
    connectionString: db.connectionString,
    role: 'mio_worker',
    max: 3,
  });
  appPool = createRolePool({ connectionString: db.connectionString, role: 'mio_app', max: 3 });
  workerBus = await createJobBus({ pool: workerPool });
  appBus = await createJobBus({ pool: appPool });
  await workerBus.createQueue(QUEUES.heartbeat);
});

afterAll(async () => {
  await appBus?.stop({ graceful: false });
  await workerBus?.stop({ graceful: false });
  await appPool?.end();
  await workerPool?.end();
  await db?.stop();
});

describe('the job bus (ADR-0008)', () => {
  it('app role enqueues, worker role consumes', async () => {
    const received = new Promise<unknown>((resolve) => {
      void workerBus.work(QUEUES.heartbeat, async (jobs) => {
        for (const job of jobs) resolve(job.data);
      });
    });

    const jobId = await appBus.send(QUEUES.heartbeat, { beat: 1 });
    expect(jobId).toBeTruthy();
    expect(await received).toEqual({ beat: 1 });
  });

  it('a rolled-back transaction leaves no job behind (the outbox property)', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      const jobId = await sendInTransaction(appBus, client, QUEUES.heartbeat, { beat: 'doomed' });
      expect(jobId).toBeTruthy();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const committed = await appPool.query(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND data->>'beat' = 'doomed'",
      [QUEUES.heartbeat],
    );
    expect(committed.rows[0].n).toBe(0);
  });
});
