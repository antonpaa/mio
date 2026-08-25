import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent } from '@mio/db';
import { APP_POOL } from '../../shared/db.module.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * A4 reporting (gate P8, decided 2026-08-24): the metrics are clinical
 * aggregates, so the screen lives on the CLINICAL side and report.view
 * is denied to administrators and auditors - consistent with
 * patient_clinical_profile. Everything here is scoped to the caller's
 * own treatments (team_member slice) and aggregated before it leaves
 * the database: no patient identity crosses this boundary, only counts
 * and rates. The one Cedar decision + list-level access event follow
 * the C1 triage precedent.
 */

export interface ReportOverview {
  windowDays: number;
  surveys: {
    /** due in the last 30 days */
    due: number;
    completed: number;
    /** 0-100, null when nothing was due */
    ratePercent: number | null;
    /** rate delta vs the previous 30 days, in points; null when either window is empty */
    deltaPoints: number | null;
  };
  alerts: {
    openNow: number;
    openHigh: number;
    /** age of the oldest open high alert, whole days; null when none */
    oldestHighDays: number | null;
    /** median acknowledge time for high alerts, hours; null when none in window */
    medianAckHours: number | null;
  };
  programs: {
    program: string;
    patients: number;
    due: number;
    completed: number;
    ratePercent: number | null;
    openAlerts: number;
    openHigh: number;
    openModerate: number;
  }[];
}

const MINE = `
  SELECT t.id, t.name, t.patient_id
    FROM clinical.treatment t
   WHERE t.state <> 'draft' AND t.archived_at IS NULL
     AND EXISTS (
       SELECT 1 FROM clinical.treatment_care_team ct
         LEFT JOIN identity.team_membership tm ON tm.team_id = ct.team_id
        WHERE ct.treatment_id = t.id AND ct.removed_at IS NULL
          AND (ct.staff_id = $1 OR tm.staff_id = $1)
     )`;

@Injectable()
export class ReportingService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  async overview(staff: StaffPrincipal): Promise<ReportOverview> {
    const decision = authorize({
      principal: { userId: staff.userId, roles: staff.roles },
      action: 'view',
      resource: { type: 'report', id: 'overview', teamUserIds: [staff.userId] },
    });
    if (decision.decision !== 'allow') {
      throw new ForbiddenException({ status: 'forbidden' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows: surveyRows } = await client.query<{
        due: number;
        completed: number;
        prev_due: number;
        prev_completed: number;
      }>(
        `WITH mine AS (${MINE})
         SELECT count(*) FILTER (WHERE a.occurrence_date > current_date - 30)::int AS due,
                count(*) FILTER (WHERE a.occurrence_date > current_date - 30
                                   AND a.status = 'completed')::int AS completed,
                count(*) FILTER (WHERE a.occurrence_date <= current_date - 30)::int AS prev_due,
                count(*) FILTER (WHERE a.occurrence_date <= current_date - 30
                                   AND a.status = 'completed')::int AS prev_completed
           FROM clinical.activity a
           JOIN mine m ON m.id = a.treatment_id
          WHERE a.kind = 'survey' AND a.status <> 'cancelled'
            AND a.occurrence_date > current_date - 60
            AND a.occurrence_date <= current_date`,
        [staff.userId],
      );
      const s = surveyRows[0]!;
      const rate = (done: number, due: number): number | null =>
        due > 0 ? Math.round((done / due) * 100) : null;
      const ratePercent = rate(s.completed, s.due);
      const prevRate = rate(s.prev_completed, s.prev_due);

      const { rows: alertRows } = await client.query<{
        open_now: number;
        open_high: number;
        oldest_high_days: number | null;
        median_ack_hours: string | null;
      }>(
        `WITH mine AS (${MINE})
         SELECT count(*) FILTER (WHERE a.status <> 'resolved')::int AS open_now,
                count(*) FILTER (WHERE a.status <> 'resolved' AND a.severity = 'high')::int
                  AS open_high,
                (extract(epoch FROM now() - min(a.created_at)
                   FILTER (WHERE a.status <> 'resolved' AND a.severity = 'high')) / 86400)::int
                  AS oldest_high_days,
                (percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY extract(epoch FROM a.acknowledged_at - a.created_at))
                   FILTER (WHERE a.severity = 'high' AND a.acknowledged_at IS NOT NULL
                             AND a.acknowledged_at > now() - interval '30 days') / 3600)::numeric(10,1)
                  ::text AS median_ack_hours
           FROM clinical.alert a
           JOIN mine m ON m.id = a.treatment_id`,
        [staff.userId],
      );
      const a = alertRows[0]!;

      const { rows: programRows } = await client.query<{
        program: string;
        patients: number;
        due: number;
        completed: number;
        open_alerts: number;
        open_high: number;
        open_moderate: number;
      }>(
        `WITH mine AS (${MINE})
         SELECT m.name AS program,
                count(DISTINCT m.patient_id)::int AS patients,
                -- both joins fan out (activities x alerts per treatment):
                -- every aggregate below must count DISTINCT ids
                count(DISTINCT a.id) FILTER (WHERE a.kind = 'survey' AND a.status <> 'cancelled'
                    AND a.occurrence_date > current_date - 30
                    AND a.occurrence_date <= current_date)::int AS due,
                count(DISTINCT a.id) FILTER (WHERE a.kind = 'survey' AND a.status = 'completed'
                    AND a.occurrence_date > current_date - 30
                    AND a.occurrence_date <= current_date)::int AS completed,
                count(DISTINCT al.id) FILTER (WHERE al.status <> 'resolved')::int AS open_alerts,
                count(DISTINCT al.id) FILTER (WHERE al.status <> 'resolved'
                    AND al.severity = 'high')::int AS open_high,
                count(DISTINCT al.id) FILTER (WHERE al.status <> 'resolved'
                    AND al.severity = 'moderate')::int AS open_moderate
           FROM mine m
           LEFT JOIN clinical.activity a ON a.treatment_id = m.id
           LEFT JOIN clinical.alert al ON al.treatment_id = m.id
          GROUP BY m.name
          ORDER BY count(DISTINCT m.patient_id) DESC, m.name`,
        [staff.userId],
      );

      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'report.view',
        resourceType: 'report',
        resourceId: null,
        patientId: null,
        decision: 'allow',
        context: { programs: programRows.length },
      });

      return {
        windowDays: 30,
        surveys: {
          due: s.due,
          completed: s.completed,
          ratePercent,
          deltaPoints: ratePercent !== null && prevRate !== null ? ratePercent - prevRate : null,
        },
        alerts: {
          openNow: a.open_now,
          openHigh: a.open_high,
          oldestHighDays: a.oldest_high_days,
          medianAckHours: a.median_ack_hours === null ? null : Number(a.median_ack_hours),
        },
        programs: programRows.map((row) => ({
          program: row.program,
          patients: row.patients,
          due: row.due,
          completed: row.completed,
          ratePercent: rate(row.completed, row.due),
          openAlerts: row.open_alerts,
          openHigh: row.open_high,
          openModerate: row.open_moderate,
        })),
      };
    });
  }
}
