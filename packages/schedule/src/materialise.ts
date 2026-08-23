import { expandSchedule, type ScheduleDefinition } from './expand.js';
import { parseDate, zonedTimeToUtc } from './dates.js';

/**
 * Materialisation: occurrences become clinical.activity rows so calendars
 * and worklists are ordinary SQL and each occurrence has an identity that
 * can be confirmed, completed or cancelled (docs/architecture/scheduling.md).
 * Runs inside the caller's transaction; idempotent per (schedule, date).
 *
 * The db surface is a minimal structural interface on purpose: this package
 * stays dependency-free and both the API (immediate materialisation) and
 * the worker (horizon extension) pass their own client.
 */

export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface ScheduleRow {
  id: string;
  treatment_id: string;
  patient_id: string;
  timezone: string;
  anchor_date: string;
  segments: ScheduleDefinition['segments'];
  add_dates: string[] | null;
  remove_dates: string[] | null;
  payload: { title: string; kind?: string; location?: string; timeOfDay?: string };
}

export const DEFAULT_HORIZON_DAYS = 365;

export function definitionOf(schedule: ScheduleRow): ScheduleDefinition {
  return {
    anchorDate: schedule.anchor_date,
    segments: schedule.segments,
    ...(schedule.add_dates ? { addDates: schedule.add_dates } : {}),
    ...(schedule.remove_dates ? { removeDates: schedule.remove_dates } : {}),
  };
}

/** Insert activities for occurrences in [from, to]; existing (schedule,
 * date) rows are left untouched - including completed or cancelled ones. */
export async function materialiseSchedule(
  client: QueryClient,
  schedule: ScheduleRow,
  window: { from: string; to: string },
): Promise<number> {
  const occurrences = expandSchedule(definitionOf(schedule), window);
  let inserted = 0;
  for (const iso of occurrences) {
    const timeOfDay = schedule.payload.timeOfDay;
    let occursAt: Date | null = null;
    if (timeOfDay !== undefined) {
      const [hour, minute] = timeOfDay.split(':').map(Number);
      occursAt = zonedTimeToUtc(parseDate(iso), hour ?? 9, minute ?? 0, schedule.timezone);
    }
    const result = await client.query(
      `INSERT INTO clinical.activity
         (treatment_id, patient_id, schedule_id, occurrence_date, title, kind, location, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned')
       ON CONFLICT (schedule_id, occurrence_date) WHERE schedule_id IS NOT NULL DO NOTHING`,
      [
        schedule.treatment_id,
        schedule.patient_id,
        schedule.id,
        iso,
        schedule.payload.title,
        schedule.payload.kind ?? 'other',
        schedule.payload.location ?? null,
        occursAt,
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/** Future planned occurrences of a schedule are regenerated after an edit;
 * anything a human touched (confirmed/completed/cancelled) stays. */
export async function rematerialiseFuture(
  client: QueryClient,
  schedule: ScheduleRow,
  fromInclusive: string,
  toInclusive: string,
): Promise<{ removed: number; inserted: number }> {
  const removedResult = await client.query(
    `DELETE FROM clinical.activity
      WHERE schedule_id = $1 AND occurrence_date >= $2 AND status = 'planned'`,
    [schedule.id, fromInclusive],
  );
  const inserted = await materialiseSchedule(client, schedule, {
    from: fromInclusive,
    to: toInclusive,
  });
  return { removed: removedResult.rowCount ?? 0, inserted };
}
