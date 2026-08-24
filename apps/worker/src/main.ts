import { createJobBus, createRolePool, QUEUES } from '@mio/db';
import {
  addDays,
  DEFAULT_HORIZON_DAYS,
  formatDate,
  materialiseSchedule,
  parseDate,
  type ScheduleRow,
} from '@mio/schedule';
import type pg from 'pg';
import {
  createClamAvScanner,
  createDevScanner,
  createFsStorage,
  createGcsStorage,
  type GcsServiceAccount,
} from '@mio/storage';
import { readFileSync } from 'node:fs';
import { createLifecycle } from './lifecycle.js';
import { archiveSettledTreatments, exportAuditDays } from './retention.js';
import { scanAttachments } from './attachment-scan.js';
import { createReminderSender } from './reminder-mail.js';
import { dispatchNotifications } from './notification-dispatch.js';
import { createNotificationSender } from './notification-mail.js';
import { sweepSurveyOccurrences } from './survey-sweep.js';

const lifecycle = createLifecycle();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void lifecycle.shutdown().then(() => process.exit(0));
  });
}

const log = (level: 'info' | 'error', msg: string, extra: object = {}): void => {
  console.error(JSON.stringify({ level, msg, pid: process.pid, ...extra }));
};

/** Roll every live schedule's materialisation horizon forward (WP-12).
 * Runs daily; also safe to run any time - (schedule, date) is idempotent. */
export async function extendScheduleHorizons(
  pool: { connect(): Promise<pg.PoolClient> },
  today = new Date().toISOString().slice(0, 10),
): Promise<number> {
  const horizonTo = formatDate(addDays(parseDate(today), DEFAULT_HORIZON_DAYS));
  const client = await pool.connect();
  let extended = 0;
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.realm', 'system', true)`,
    );
    const { rows } = await client.query(
      `SELECT id, treatment_id, patient_id, timezone, anchor_date::text, segments,
              add_dates, remove_dates, payload, generated_until::text
         FROM clinical.schedule WHERE ended_at IS NULL AND generated_until < $1`,
      [horizonTo],
    );
    for (const raw of rows as (ScheduleRow & { generated_until: string })[]) {
      const inserted = await materialiseSchedule(client, raw, {
        from: raw.generated_until,
        to: horizonTo,
      });
      await client.query(`UPDATE clinical.schedule SET generated_until = $2 WHERE id = $1`, [
        raw.id,
        horizonTo,
      ]);
      extended += inserted;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return extended;
}

async function main(): Promise<void> {
  const connectionString = process.env['MIO_DATABASE_URL'];
  if (!connectionString) {
    log('info', 'mio worker started without MIO_DATABASE_URL - idle');
    return;
  }

  const pool = createRolePool({ connectionString, role: 'mio_worker' });
  const boss = await createJobBus({ pool });
  lifecycle.onStop(async () => {
    await boss.stop({ graceful: true });
    await pool.end();
  });

  await boss.createQueue(QUEUES.scheduleExtend);
  await boss.work(QUEUES.scheduleExtend, async () => {
    const extended = await extendScheduleHorizons(pool);
    log('info', 'schedule horizons extended', { activities: extended });
  });
  // Daily at 03:10 - and once shortly after boot so a long-stopped worker
  // catches up without waiting for the clock.
  await boss.schedule(QUEUES.scheduleExtend, '10 3 * * *');
  await boss.send(QUEUES.scheduleExtend, {});

  const sendReminder = createReminderSender();
  await boss.createQueue(QUEUES.surveySweep);
  await boss.work(QUEUES.surveySweep, async () => {
    const result = await sweepSurveyOccurrences(pool, sendReminder);
    log('info', 'survey occurrences swept', { ...result });
  });
  await boss.schedule(QUEUES.surveySweep, '40 3 * * *');
  await boss.send(QUEUES.surveySweep, {});

  // WP-25: outbox + rule notifications into the in-app centre and the
  // contentless email nudge. Frequent - a notification is only useful
  // near its moment.
  const sendNotification = createNotificationSender();
  await boss.createQueue(QUEUES.notificationDispatch);
  await boss.work(QUEUES.notificationDispatch, async () => {
    const result = await dispatchNotifications(pool, sendNotification);
    if (result.outboxProcessed > 0 || result.rulesDispatched > 0) {
      log('info', 'notifications dispatched', { ...result });
    }
  });
  await boss.schedule(QUEUES.notificationDispatch, '*/5 * * * *');
  await boss.send(QUEUES.notificationDispatch, {});

  // WP-24: the quarantine sweep - same storage seam as the API, ClamAV
  // when configured, the EICAR-aware dev scanner otherwise.
  const gcsBucket = process.env['MIO_GCS_BUCKET'];
  const gcsKeyFile = process.env['MIO_GCS_KEY_FILE'];
  const storage =
    gcsBucket && gcsKeyFile
      ? createGcsStorage({
          bucket: gcsBucket,
          account: JSON.parse(readFileSync(gcsKeyFile, 'utf8')) as GcsServiceAccount,
        })
      : createFsStorage(process.env['MIO_STORAGE_DIR'] ?? '.storage-dev');
  const clamAddr = process.env['MIO_CLAMAV_ADDR'];
  const scanner = clamAddr ? createClamAvScanner(clamAddr) : createDevScanner();
  await boss.createQueue(QUEUES.attachmentScan);
  await boss.work(QUEUES.attachmentScan, async () => {
    const result = await scanAttachments(pool, storage, scanner);
    if (result.scanned > 0) log('info', 'attachments scanned', { ...result });
  });
  await boss.schedule(QUEUES.attachmentScan, '* * * * *');
  await boss.send(QUEUES.attachmentScan, {});

  // WP-29: the retention pair. Archival stamps settled treatments after
  // their quiet period; the audit export copies whole days of audit
  // events to object storage through the audit-reader carrier (the
  // worker role itself stays INSERT-only on audit.*).
  await boss.createQueue(QUEUES.retentionSweep);
  await boss.work(QUEUES.retentionSweep, async () => {
    const archived = await archiveSettledTreatments(pool);
    if (archived > 0) log('info', 'treatments archived', { archived });
  });
  await boss.schedule(QUEUES.retentionSweep, '20 4 * * *');
  await boss.send(QUEUES.retentionSweep, {});

  const auditReader = createRolePool({ connectionString, role: 'mio_audit_reader' });
  lifecycle.onStop(async () => {
    await auditReader.end();
  });
  await boss.createQueue(QUEUES.auditExport);
  await boss.work(QUEUES.auditExport, async () => {
    const result = await exportAuditDays(pool, auditReader, storage);
    if (result.days > 0) log('info', 'audit days exported', { ...result });
  });
  await boss.schedule(QUEUES.auditExport, '50 4 * * *');
  await boss.send(QUEUES.auditExport, {});

  log('info', 'mio worker started, job bus running');
}

main().catch((error) => {
  log('error', `worker failed to start: ${String(error)}`);
  process.exit(1);
});
