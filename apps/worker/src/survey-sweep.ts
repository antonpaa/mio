import type pg from 'pg';
import { persistEvaluation, ruleTextsFromBundles, writeChangeEvent } from '@mio/db';
import {
  evaluateTrends,
  type LocaleBundle,
  type SurveyDefinition,
  type TrendEntry,
} from '@mio/survey-schema';

/**
 * The daily survey-occurrence sweep (WP-17/20,
 * docs/architecture/scheduling.md + surveys-and-alerts.md):
 *
 *  - REMINDERS: an occurrence whose reminder day arrived and is still
 *    unanswered gets ONE contentless nudge - type and deeplink only, never
 *    clinical content (structural guarantee 3). Idempotent through the
 *    change-event log, so re-runs never double-send.
 *  - MISSED: when the answer window closes unanswered, the occurrence is
 *    MARKED missed - a real state, distinct from cancelled - and the
 *    treatment's TREND RULES evaluate over the occurrence history in the
 *    same transaction. Only missed-kind conditions can fire off a missed
 *    anchor (a streak ending in a miss is never "submitted N in a row"),
 *    and the (rule, occurrence) unique pair makes re-runs no-ops.
 */

export interface ReminderMail {
  recipient: string;
  locale: string;
}

export interface SweepResult {
  reminders: number;
  missed: number;
  /** trend rules fired off newly-missed occurrences */
  trendFired: number;
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
    const { rows: missedRows } = await client.query<{
      id: string;
      patient_id: string;
      treatment_id: string;
      survey_id: string | null;
      occurrence_date: string;
    }>(
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
        RETURNING a.id, a.patient_id, a.treatment_id,
                  COALESCE(a.survey_id, sch.survey_id) AS survey_id,
                  a.occurrence_date::text AS occurrence_date`,
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

    const trendFired = await evaluateMissedTrends(client, missedRows);

    await client.query('COMMIT');
    return { reminders: reminders.length, missed: missedRows.length, trendFired };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Trend evaluation for each (treatment, survey) that just gained missed
 * occurrences, anchored to the LATEST one. The rule set is the
 * treatment's EFFECTIVE version - pinned, else newest published - the
 * same resolution the fill path uses.
 */
async function evaluateMissedTrends(
  client: pg.PoolClient,
  missedRows: {
    id: string;
    patient_id: string;
    treatment_id: string;
    survey_id: string | null;
    occurrence_date: string;
  }[],
): Promise<number> {
  const anchors = new Map<string, (typeof missedRows)[number]>();
  for (const row of missedRows) {
    if (row.survey_id === null) continue;
    const key = `${row.treatment_id}|${row.survey_id}`;
    const held = anchors.get(key);
    if (!held || row.occurrence_date > held.occurrence_date) anchors.set(key, row);
  }
  let fired = 0;
  for (const anchor of anchors.values()) {
    const { rows: versions } = await client.query<{
      id: string;
      definition: SurveyDefinition;
      locales: LocaleBundle[];
    }>(
      `SELECT v.id, v.definition, v.locales
         FROM clinical.treatment_survey ts
         JOIN clinical.survey_version v ON v.id = COALESCE(
           ts.pinned_version_id,
           (SELECT v2.id FROM clinical.survey_version v2
             WHERE v2.survey_id = ts.survey_id AND v2.state = 'published'
             ORDER BY v2.version DESC LIMIT 1))
        WHERE ts.treatment_id = $1 AND ts.survey_id = $2 AND ts.removed_at IS NULL`,
      [anchor.treatment_id, anchor.survey_id],
    );
    const version = versions[0];
    if (!version || (version.definition.trendRules ?? []).length === 0) continue;

    const { rows: history } = await client.query<{
      activity_id: string;
      date: string;
      status: string;
      response_id: string | null;
      answers: Record<string, unknown> | null;
    }>(
      `SELECT a.id AS activity_id, a.occurrence_date::text AS date, a.status,
              r.id AS response_id, r.answers
         FROM clinical.activity a
         LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
         LEFT JOIN clinical.survey_response r
                ON r.activity_id = a.id AND r.status = 'submitted'
        WHERE a.treatment_id = $1 AND a.kind = 'survey'
          AND COALESCE(a.survey_id, sch.survey_id) = $2
          AND a.occurrence_date <= $3
        ORDER BY a.occurrence_date DESC, a.id DESC
        LIMIT 24`,
      [anchor.treatment_id, anchor.survey_id, anchor.occurrence_date],
    );
    const entries: TrendEntry[] = history.reverse().map((row) =>
      row.response_id !== null
        ? {
            date: row.date,
            status: 'submitted',
            responseId: row.response_id,
            activityId: row.activity_id,
            answers: row.answers ?? {},
          }
        : {
            date: row.date,
            status: row.status === 'missed' ? 'missed' : 'open',
            activityId: row.activity_id,
          },
    );
    const evaluation = evaluateTrends(version.definition, entries);
    if (evaluation.fired.length === 0) continue;
    const persisted = await persistEvaluation(
      client,
      {
        treatmentId: anchor.treatment_id,
        patientId: anchor.patient_id,
        surveyVersionId: version.id,
        surveyResponseId: null,
        activityId: anchor.id,
        ruleTexts: ruleTextsFromBundles(version.locales),
      },
      evaluation,
    );
    fired += persisted.triggerIds.length;
    if (persisted.alertId !== null) {
      await writeChangeEvent(client, {
        actorUserId: null,
        actorRealm: 'system',
        action: 'alert.raise',
        resourceType: 'alert',
        resourceId: persisted.alertId,
        patientId: anchor.patient_id,
        detail: { severity: evaluation.severity, ruleIds: evaluation.fired.map((f) => f.ruleId) },
      });
    }
  }
  return fired;
}
