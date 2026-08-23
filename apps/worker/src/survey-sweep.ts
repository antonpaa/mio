import type pg from 'pg';
import { writeChangeEvent } from '@mio/db';

/**
 * The daily survey-occurrence sweep (WP-17, docs/architecture/scheduling.md
 * + surveys-and-alerts.md):
 *
 *  - REMINDERS: an occurrence whose reminder day arrived and is still
 *    unanswered gets ONE contentless nudge - type and deeplink only, never
 *    clinical content (structural guarantee 3). Idempotent through the
 *    change-event log, so re-runs never double-send.
 *  - MISSED: when the answer window closes unanswered, the occurrence is
 *    MARKED missed - a real state the missed-response rules (WP-20) run
 *    over, distinct from cancelled.
 */

export interface ReminderMail {
  recipient: string;
  locale: string;
}

export interface SweepResult {
  reminders: number;
  missed: number;
}

export async function sweepSurveyOccurrences(
  pool: { connect(): Promise<pg.PoolClient> },
  sendReminder: (mail: ReminderMail) => Promise<void>,
  today = new Date().toISOString().slice(0, 10),
): Promise<SweepResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.realm', 'system', true)`,
    );

    // Reminders due today, not yet sent (the change-event log is the
    // dedupe), occurrence still open and unanswered.
    const { rows: reminders } = await client.query<{
      id: string;
      patient_id: string;
      email: string;
      locale: string;
    }>(
      `SELECT a.id, a.patient_id, p.email, p.locale
         FROM clinical.activity a
         JOIN clinical.schedule sch ON sch.id = a.schedule_id
         JOIN identity.patient_account p ON p.id = a.patient_id
        WHERE a.kind = 'survey' AND a.status IN ('planned', 'confirmed')
          AND sch.reminder_after_days IS NOT NULL
          AND a.occurrence_date + sch.reminder_after_days * INTERVAL '1 day' <= $1::date
          AND a.reminded_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM clinical.survey_response r
             WHERE r.activity_id = a.id AND r.status = 'submitted')`,
      [today],
    );
    for (const row of reminders) {
      await sendReminder({ recipient: row.email, locale: row.locale });
      await client.query(`UPDATE clinical.activity SET reminded_at = now() WHERE id = $1`, [
        row.id,
      ]);
      await writeChangeEvent(client, {
        actorUserId: null,
        actorRealm: 'system',
        action: 'survey_reminder.sent',
        resourceType: 'activity',
        resourceId: row.id,
        patientId: row.patient_id,
      });
    }

    // Window closed, no submission: mark missed.
    const { rows: missedRows } = await client.query<{ id: string; patient_id: string }>(
      `UPDATE clinical.activity a
          SET status = 'missed', status_changed_at = now()
         FROM clinical.schedule sch
        WHERE sch.id = a.schedule_id
          AND a.kind = 'survey' AND a.status IN ('planned', 'confirmed')
          AND sch.answer_window_days IS NOT NULL
          AND a.occurrence_date + sch.answer_window_days * INTERVAL '1 day' < $1::date
          AND NOT EXISTS (
            SELECT 1 FROM clinical.survey_response r
             WHERE r.activity_id = a.id AND r.status = 'submitted')
        RETURNING a.id, a.patient_id`,
      [today],
    );
    for (const row of missedRows) {
      await writeChangeEvent(client, {
        actorUserId: null,
        actorRealm: 'system',
        action: 'survey_occurrence.missed',
        resourceType: 'activity',
        resourceId: row.id,
        patientId: row.patient_id,
      });
    }

    await client.query('COMMIT');
    return { reminders: reminders.length, missed: missedRows.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
