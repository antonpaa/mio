import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import {
  addDays,
  DEFAULT_HORIZON_DAYS,
  expandSchedule,
  formatDate,
  materialiseSchedule,
  parseDate,
  rematerialiseFuture,
  type ScheduleRow,
  type ScheduleSegment,
} from '@mio/schedule';
import { APP_POOL } from '../../shared/db.module.js';
import { MAILER, type Mailer } from '../identity/index.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * Scheduling (WP-12): one-off activities, recurrence schedules with
 * immediate materialisation, status transitions, and the patient calendar.
 * Same decision pattern as every clinical module: scope in SQL, decide in
 * Cedar against the treatment's team slice, audit in the same transaction.
 */

export interface ScheduleInput {
  timezone?: string;
  anchorDate: string;
  segments: ScheduleSegment[];
  payload: { title: string; kind?: string; location?: string; timeOfDay?: string };
  answerWindowDays?: number;
  reminderAfterDays?: number;
  escalateUnanswered?: boolean;
}

const ACTIVITY_STATUS_FLOW: Record<string, string[]> = {
  planned: ['confirmed', 'completed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(APP_POOL) private readonly pool: pg.Pool,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private async treatmentContext(
    client: pg.ClientBase,
    treatmentId: string,
  ): Promise<
    | { patientId: string; teamUserIds: string[]; leadUserIds: string[]; timezone: string }
    | undefined
  > {
    const { rows } = await client.query<{ patient_id: string }>(
      `SELECT patient_id FROM clinical.treatment WHERE id = $1`,
      [treatmentId],
    );
    const treatment = rows[0];
    if (!treatment) return undefined;
    const { rows: staffRows } = await client.query<{ staff_id: string; is_lead: boolean }>(
      `SELECT staff_id, is_lead FROM app.treatment_staff($1)`,
      [treatmentId],
    );
    const { rows: tz } = await client.query<{ timezone: string }>(
      `SELECT timezone FROM identity.patient_account WHERE id = $1`,
      [treatment.patient_id],
    );
    return {
      patientId: treatment.patient_id,
      teamUserIds: staffRows.map((row) => row.staff_id),
      leadUserIds: staffRows.filter((row) => row.is_lead).map((row) => row.staff_id),
      timezone: tz[0]?.timezone ?? 'Europe/Helsinki',
    };
  }

  /** One-off activity on a treatment (T1 "+ Add activity"). */
  async createActivity(
    staff: StaffPrincipal,
    treatmentId: string,
    input: { title: string; kind?: string; location?: string; date: string; timeOfDay?: string },
  ): Promise<{ activityId: string }> {
    if (!input.title?.trim() || !input.date) {
      throw new BadRequestException({ status: 'title_and_date_required' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'create',
        resource: {
          type: 'activity',
          id: 'new',
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
          leadUserIds: context.leadUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.create',
        resourceType: 'activity',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const activityId = randomUUID();
      let scheduledAt: Date | null = null;
      if (input.timeOfDay) {
        const [hour, minute] = input.timeOfDay.split(':').map(Number);
        const { zonedTimeToUtc } = await import('@mio/schedule');
        scheduledAt = zonedTimeToUtc(
          parseDate(input.date),
          hour ?? 9,
          minute ?? 0,
          context.timezone,
        );
      }
      await client.query(
        `INSERT INTO clinical.activity
           (id, treatment_id, patient_id, occurrence_date, title, kind, location, scheduled_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          activityId,
          treatmentId,
          context.patientId,
          input.date,
          input.title.trim(),
          input.kind ?? 'visit',
          input.location ?? null,
          scheduledAt,
          staff.userId,
        ],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.create',
        resourceType: 'activity',
        resourceId: activityId,
        patientId: context.patientId,
      });
      return { activityId };
    });
  }

  /** T1 activities list. */
  async listActivities(staff: StaffPrincipal, treatmentId: string): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: {
          type: 'activity',
          id: treatmentId,
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
          leadUserIds: context.leadUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.view',
        resourceType: 'activity_list',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      // occurrence_date::text - the pg driver would otherwise hand the web a
      // JS Date serialised as a UTC timestamp, shifting the LOCAL date.
      const { rows } = await client.query(
        `SELECT id, occurrence_date::text AS occurrence_date, title, kind, location,
                scheduled_at, status, schedule_id
           FROM clinical.activity
          WHERE treatment_id = $1
          ORDER BY coalesce(occurrence_date, scheduled_at::date), scheduled_at NULLS LAST`,
        [treatmentId],
      );
      return rows;
    });
  }

  async changeActivityStatus(
    staff: StaffPrincipal,
    activityId: string,
    to: string,
  ): Promise<{ status: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query<{
        id: string;
        treatment_id: string;
        patient_id: string;
        status: string;
      }>(`SELECT id, treatment_id, patient_id, status FROM clinical.activity WHERE id = $1`, [
        activityId,
      ]);
      const activity = rows[0];
      if (!activity) throw new NotFoundException({ status: 'unknown_activity' });
      const context = await this.treatmentContext(client, activity.treatment_id);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const action = to === 'cancelled' ? 'cancel' : 'update';
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action,
        resource: {
          type: 'activity',
          id: activityId,
          patientId: activity.patient_id,
          teamUserIds: context.teamUserIds,
          leadUserIds: context.leadUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: `activity.${action}`,
        resourceType: 'activity',
        resourceId: activityId,
        patientId: activity.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      if (!ACTIVITY_STATUS_FLOW[activity.status]?.includes(to)) {
        throw new BadRequestException({ status: 'illegal_status_change' });
      }
      await client.query(
        `UPDATE clinical.activity SET status = $2, status_changed_at = now() WHERE id = $1`,
        [activityId, to],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.status',
        resourceType: 'activity',
        resourceId: activityId,
        patientId: activity.patient_id,
        detail: { from: activity.status, to },
      });
      return { status: to };
    });
  }

  /** T3: create a recurrence schedule and materialise the horizon NOW, in
   * the same transaction - the calendar must never lag the dialog. */
  async createSchedule(
    staff: StaffPrincipal,
    treatmentId: string,
    input: ScheduleInput,
  ): Promise<{ scheduleId: string; materialised: number }> {
    if (!input.payload?.title?.trim() || !input.anchorDate || input.segments.length === 0) {
      throw new BadRequestException({ status: 'title_anchor_segments_required' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'create',
        resource: {
          type: 'activity',
          id: 'schedule',
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
          leadUserIds: context.leadUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.create',
        resourceType: 'schedule',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const timezone = input.timezone ?? context.timezone;
      // Validate the definition by expanding once - a broken rule fails
      // HERE, loudly, not silently in the worker at 3 am.
      const horizonTo = formatDate(addDays(parseDate(input.anchorDate), DEFAULT_HORIZON_DAYS));
      expandSchedule(
        { anchorDate: input.anchorDate, segments: input.segments },
        { to: horizonTo, max: 400 },
      );

      const scheduleId = randomUUID();
      await client.query(
        `INSERT INTO clinical.schedule
           (id, treatment_id, patient_id, timezone, anchor_date, segments, payload,
            answer_window_days, reminder_after_days, escalate_unanswered, generated_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          scheduleId,
          treatmentId,
          context.patientId,
          timezone,
          input.anchorDate,
          JSON.stringify(input.segments),
          JSON.stringify(input.payload),
          input.answerWindowDays ?? null,
          input.reminderAfterDays ?? null,
          input.escalateUnanswered ?? false,
          horizonTo,
          staff.userId,
        ],
      );
      const scheduleRow: ScheduleRow = {
        id: scheduleId,
        treatment_id: treatmentId,
        patient_id: context.patientId,
        timezone,
        anchor_date: input.anchorDate,
        segments: input.segments,
        add_dates: null,
        remove_dates: null,
        payload: input.payload,
      };
      const materialised = await materialiseSchedule(client, scheduleRow, {
        from: input.anchorDate,
        to: horizonTo,
      });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'schedule.create',
        resourceType: 'schedule',
        resourceId: scheduleId,
        patientId: context.patientId,
        detail: { materialised },
      });
      return { scheduleId, materialised };
    });
  }

  /** Edit a schedule: future PLANNED occurrences regenerate; anything a
   * human touched stays (docs/architecture/scheduling.md). */
  async updateSchedule(
    staff: StaffPrincipal,
    scheduleId: string,
    input: Pick<ScheduleInput, 'anchorDate' | 'segments' | 'payload'>,
    today = formatDate(parseDate(new Date().toISOString().slice(0, 10))),
  ): Promise<{ removed: number; inserted: number }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query<{
        id: string;
        treatment_id: string;
        patient_id: string;
        timezone: string;
        generated_until: string;
      }>(
        `SELECT id, treatment_id, patient_id, timezone, generated_until::text
           FROM clinical.schedule WHERE id = $1 AND ended_at IS NULL`,
        [scheduleId],
      );
      const schedule = rows[0];
      if (!schedule) throw new NotFoundException({ status: 'unknown_schedule' });
      const context = await this.treatmentContext(client, schedule.treatment_id);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'update',
        resource: {
          type: 'activity',
          id: scheduleId,
          patientId: schedule.patient_id,
          teamUserIds: context.teamUserIds,
          leadUserIds: context.leadUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.update',
        resourceType: 'schedule',
        resourceId: scheduleId,
        patientId: schedule.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      await client.query(
        `UPDATE clinical.schedule SET anchor_date = $2, segments = $3, payload = $4 WHERE id = $1`,
        [
          scheduleId,
          input.anchorDate,
          JSON.stringify(input.segments),
          JSON.stringify(input.payload),
        ],
      );
      const scheduleRow: ScheduleRow = {
        id: scheduleId,
        treatment_id: schedule.treatment_id,
        patient_id: schedule.patient_id,
        timezone: schedule.timezone,
        anchor_date: input.anchorDate,
        segments: input.segments,
        add_dates: null,
        remove_dates: null,
        payload: input.payload,
      };
      const result = await rematerialiseFuture(
        client,
        scheduleRow,
        today,
        schedule.generated_until,
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'schedule.update',
        resourceType: 'schedule',
        resourceId: scheduleId,
        patientId: schedule.patient_id,
        detail: result,
      });
      return result;
    });
  }

  /** P9: the patient's consolidated calendar. One list-level audit event. */
  async patientCalendar(patientUserId: string): Promise<object[]> {
    return withUserContext(
      this.pool,
      { userId: patientUserId, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query(
          `SELECT a.id, a.occurrence_date::text AS occurrence_date, a.title, a.kind,
                  a.location, a.scheduled_at, a.status,
                  t.name AS treatment_name
             FROM clinical.activity a
             JOIN clinical.treatment t ON t.id = a.treatment_id
            WHERE a.patient_id = $1
              AND a.status IN ('planned', 'confirmed')
              AND coalesce(a.occurrence_date, a.scheduled_at::date) >= current_date - 1
            ORDER BY coalesce(a.occurrence_date, a.scheduled_at::date), a.scheduled_at NULLS LAST
            LIMIT 60`,
          [patientUserId],
        );
        await writeAccessEvent(client, {
          actorUserId: patientUserId,
          actorRealm: 'patient',
          action: 'activity.view',
          resourceType: 'calendar',
          resourceId: patientUserId,
          patientId: patientUserId,
          decision: 'allow',
        });
        return rows;
      },
    );
  }

  /** C1 (WP-27): overdue survey occurrences across the caller's care
   * patients - due date passed, nothing submitted, not yet marked
   * missed. One list-level access event carries the disclosed ids. */
  async staffOverdue(staff: StaffPrincipal): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query(
        `SELECT a.id, a.treatment_id, a.patient_id,
                a.occurrence_date::text AS occurrence_date,
                a.reminded_at::text AS reminded_at,
                t.name AS treatment_name,
                p.given_name AS patient_given, p.family_name AS patient_family,
                s.name AS survey_name
           FROM clinical.activity a
           JOIN clinical.treatment t ON t.id = a.treatment_id
           JOIN identity.patient_account p ON p.id = a.patient_id
           LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
           LEFT JOIN clinical.survey s ON s.id = COALESCE(a.survey_id, sch.survey_id)
          WHERE a.kind = 'survey' AND a.status IN ('planned', 'confirmed')
            AND a.occurrence_date < current_date
            AND NOT EXISTS (SELECT 1 FROM clinical.survey_response r
                             WHERE r.activity_id = a.id AND r.status = 'submitted')
            AND EXISTS (SELECT 1 FROM clinical.care_relationship cr
                         WHERE cr.patient_id = a.patient_id
                           AND cr.staff_id = $1 AND cr.ended_at IS NULL)
          ORDER BY a.occurrence_date
          LIMIT 50`,
        [staff.userId],
      );
      for (const row of rows as { id: string; patient_id: string }[]) {
        const decision = authorize({
          principal: { userId: staff.userId, role: staff.role },
          action: 'view',
          resource: {
            type: 'activity',
            id: row.id,
            patientId: row.patient_id,
            teamUserIds: [staff.userId],
          },
        });
        if (decision.decision !== 'allow') {
          throw new ForbiddenException({ status: 'scoping_policy_disagreement' });
        }
      }
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.view',
        resourceType: 'overdue_worklist',
        resourceId: null,
        patientId: null,
        decision: 'allow',
        context: {
          patientIds: [...new Set((rows as { patient_id: string }[]).map((r) => r.patient_id))],
        },
      });
      return rows as object[];
    });
  }

  /** The manual reminder behind C1's control: contentless email only,
   * honouring the patient's P8 toggle - a declined email sends nothing
   * and marks nothing. */
  async remindActivity(staff: StaffPrincipal, activityId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query<{
        id: string;
        treatment_id: string;
        patient_id: string;
        status: string;
        kind: string;
      }>(
        `SELECT id, treatment_id, patient_id, status, kind
           FROM clinical.activity WHERE id = $1`,
        [activityId],
      );
      const activity = rows[0];
      // RLS hides out-of-care rows - the same 404 as an unknown id
      if (!activity) throw new NotFoundException({ status: 'unknown_activity' });
      if (activity.kind !== 'survey' || !['planned', 'confirmed'].includes(activity.status)) {
        throw new BadRequestException({ status: 'not_remindable' });
      }
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'remind',
        resource: {
          type: 'activity',
          id: activity.id,
          patientId: activity.patient_id,
          teamUserIds: [staff.userId],
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.remind',
        resourceType: 'activity',
        resourceId: activity.id,
        patientId: activity.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const { rows: contacts } = await client.query<{
        email: string;
        locale: 'en' | 'fi' | 'sv';
        email_prefs: Record<string, unknown>;
      }>(`SELECT email, locale, email_prefs FROM identity.patient_account WHERE id = $1`, [
        activity.patient_id,
      ]);
      const contact = contacts[0]!;
      if (contact.email_prefs['survey_reminder'] === false) {
        return { sent: false, reason: 'email_declined' };
      }
      await this.mailer.send({
        recipient: contact.email,
        kind: 'survey_reminder',
        locale: contact.locale,
        deepLink: '/surveys',
      });
      await client.query(`UPDATE clinical.activity SET reminded_at = now() WHERE id = $1`, [
        activity.id,
      ]);
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_reminder.sent',
        resourceType: 'activity',
        resourceId: activity.id,
        patientId: activity.patient_id,
      });
      return { sent: true };
    });
  }

  /** C1's today-and-upcoming slice: the next week of activities across
   * the caller's care patients. */
  async staffAgenda(staff: StaffPrincipal): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query(
        `SELECT a.id, a.patient_id, a.treatment_id, a.title, a.kind, a.location, a.status,
                a.occurrence_date::text AS occurrence_date, a.scheduled_at,
                t.name AS treatment_name,
                p.given_name AS patient_given, p.family_name AS patient_family
           FROM clinical.activity a
           JOIN clinical.treatment t ON t.id = a.treatment_id
           JOIN identity.patient_account p ON p.id = a.patient_id
          WHERE a.status IN ('planned', 'confirmed')
            AND coalesce(a.occurrence_date, a.scheduled_at::date)
                BETWEEN current_date AND current_date + 7
            AND EXISTS (SELECT 1 FROM clinical.care_relationship cr
                         WHERE cr.patient_id = a.patient_id
                           AND cr.staff_id = $1 AND cr.ended_at IS NULL)
          ORDER BY coalesce(a.occurrence_date, a.scheduled_at::date), a.scheduled_at NULLS LAST
          LIMIT 60`,
        [staff.userId],
      );
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'activity.view',
        resourceType: 'agenda_worklist',
        resourceId: null,
        patientId: null,
        decision: 'allow',
        context: {
          patientIds: [...new Set((rows as { patient_id: string }[]).map((r) => r.patient_id))],
        },
      });
      return rows as object[];
    });
  }
}
