import type pg from 'pg';
import { writeChangeEvent } from '@mio/db';
import type { ObjectStorage, Scanner } from '@mio/storage';

/**
 * WP-24: the quarantine sweep. Polls quarantined rows (the WP-17 sweep
 * pattern - a lost message can never strand a file), scans the stored
 * bytes and promotes or rejects. Rejected bytes are deleted at once:
 * nothing the scanner refused stays on disk, only the row saying WHY
 * survives.
 */

export interface ScanSweepResult {
  scanned: number;
  clean: number;
  rejected: number;
}

export async function scanAttachments(
  pool: { connect(): Promise<pg.PoolClient> },
  storage: ObjectStorage,
  scanner: Scanner,
): Promise<ScanSweepResult> {
  const client = await pool.connect();
  const result: ScanSweepResult = { scanned: 0, clean: 0, rejected: 0 };
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.realm', 'system', true)`,
    );
    const { rows } = await client.query<{
      id: string;
      patient_id: string;
      storage_key: string;
    }>(
      `SELECT id, patient_id, storage_key FROM clinical.attachment
        WHERE state = 'quarantined' ORDER BY created_at LIMIT 50`,
    );
    for (const row of rows) {
      const bytes = await storage.get(row.storage_key);
      let verdict: 'clean' | 'infected';
      let detail: string;
      if (bytes === null) {
        verdict = 'infected';
        detail = 'bytes missing from storage';
      } else {
        const scan = await scanner.scan(bytes);
        verdict = scan.verdict;
        detail = scan.detail;
      }
      const state = verdict === 'clean' ? 'clean' : 'rejected';
      await client.query(
        `UPDATE clinical.attachment
            SET state = $2, scan_detail = $3, scanned_at = now()
          WHERE id = $1`,
        [row.id, state, detail],
      );
      if (state === 'rejected') {
        await storage.delete(row.storage_key);
      }
      await writeChangeEvent(client, {
        actorUserId: null,
        actorRealm: 'system',
        action: 'attachment.scanned',
        resourceType: 'attachment',
        resourceId: row.id,
        patientId: row.patient_id,
        detail: { state },
      });
      result.scanned += 1;
      if (state === 'clean') result.clean += 1;
      else result.rejected += 1;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return result;
}
