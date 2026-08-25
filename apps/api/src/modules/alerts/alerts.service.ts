import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import type { LocaleBundle, RuleTrace } from '@mio/survey-schema';
import { citeTrigger } from '../../shared/trigger-citation.js';
import { APP_POOL } from '../../shared/db.module.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * Alert workflow (WP-19): new -> acknowledged -> resolved, assignable and
 * commentable, every step audited. The PP6 timeline is assembled from
 * clinical state (workflow columns + append-only comments) because the
 * audit schema is write-only for the application. Patients never reach
 * any of this - the matrix denies every alert action to the patient role
 * and RLS carries no patient arm on the tables.
 */

interface AlertRow {
  id: string;
  treatment_id: string;
  patient_id: string;
  survey_response_id: string | null;
  severity: 'low' | 'moderate' | 'high';
  status: 'new' | 'acknowledged' | 'resolved';
  created_at: string;
  assignee_id: string | null;
}

const SEVERITY_ORDER = `CASE a.severity WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END`;

@Injectable()
export class AlertsService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  private async teamOf(client: pg.ClientBase, treatmentId: string): Promise<string[]> {
    const { rows } = await client.query<{ staff_id: string }>(
      `SELECT staff_id FROM app.treatment_staff($1)`,
      [treatmentId],
    );
    return rows.map((row) => row.staff_id);
  }

  /** C1: the triage queue - every OPEN alert across the caller's care
   * patients, severity-ranked, new before acknowledged. One list-level
   * access event carries the disclosed patient ids (task.view precedent). */
  async triage(staff: StaffPrincipal): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query(
        `SELECT a.id, a.severity, a.status, a.created_at, a.treatment_id, a.patient_id,
                a.survey_response_id, a.assignee_id,
                t.name AS treatment_name,
                p.given_name AS patient_given, p.family_name AS patient_family,
                sa.given_name AS assignee_given, sa.family_name AS assignee_family,
                s.name AS survey_name,
                (SELECT count(*)::int FROM clinical.rule_trigger rt
                  WHERE rt.alert_id = a.id) AS trigger_count
           FROM clinical.alert a
           JOIN clinical.treatment t ON t.id = a.treatment_id
           JOIN identity.patient_account p ON p.id = a.patient_id
           LEFT JOIN identity.staff_account sa ON sa.id = a.assignee_id
           LEFT JOIN clinical.survey_response r ON r.id = a.survey_response_id
           LEFT JOIN clinical.survey_version v ON v.id = r.survey_version_id
           LEFT JOIN clinical.survey s ON s.id = v.survey_id
          WHERE a.status <> 'resolved'
            AND EXISTS (SELECT 1 FROM clinical.care_relationship cr
                         WHERE cr.patient_id = a.patient_id
                           AND cr.staff_id = $1 AND cr.ended_at IS NULL)
          ORDER BY (a.status = 'new') DESC, ${SEVERITY_ORDER} DESC, a.created_at DESC`,
        [staff.userId],
      );
      // Sampled tripwire (WP-32): the resource is built identically per
      // row, so a policy/scoping disagreement is systemic and the first
      // rows trip it - see the roster's twin comment.
      for (const row of (rows as { id: string; patient_id: string }[]).slice(0, 25)) {
        const decision = authorize({
          principal: { userId: staff.userId, roles: staff.roles },
          action: 'view',
          resource: {
            type: 'alert',
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
        action: 'alert.view',
        resourceType: 'alert_triage',
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

  private async loadAlert(client: pg.ClientBase, alertId: string): Promise<AlertRow> {
    const { rows } = await client.query<AlertRow>(
      `SELECT id, treatment_id, patient_id, survey_response_id, severity, status,
              created_at::text AS created_at, assignee_id
         FROM clinical.alert WHERE id = $1`,
      [alertId],
    );
    const alert = rows[0];
    // RLS hides out-of-care rows entirely - outsiders get the same 404 as
    // a genuinely unknown id, never an existence oracle
    if (!alert) throw new NotFoundException({ status: 'unknown_alert' });
    return alert;
  }

  private async decideOn(
    client: pg.ClientBase,
    staff: StaffPrincipal,
    alert: AlertRow,
    action: 'view' | 'view_evaluation_trace' | 'acknowledge' | 'assign' | 'comment' | 'resolve',
    team: string[],
  ): Promise<void> {
    const decision = authorize({
      principal: { userId: staff.userId, roles: staff.roles },
      action,
      resource: { type: 'alert', id: alert.id, patientId: alert.patient_id, teamUserIds: team },
    });
    await writeAccessEvent(client, {
      actorUserId: staff.userId,
      actorRealm: 'staff',
      action: `alert.${action}`,
      resourceType: 'alert',
      resourceId: alert.id,
      patientId: alert.patient_id,
      decision: decision.decision,
    });
    if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
  }

  /** PP6: the alert with its triggers (cited from the trace against the
   * version's own locale bundle - survey content, not UI strings), the
   * append-only comments, the workflow fields the timeline renders, and
   * the team for the assign control. Trace disclosure is its own matrix
   * action, so the detail writes TWO access events. */
  async detail(staff: StaffPrincipal, alertId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const alert = await this.loadAlert(client, alertId);
      const team = await this.teamOf(client, alert.treatment_id);
      await this.decideOn(client, staff, alert, 'view', team);
      await this.decideOn(client, staff, alert, 'view_evaluation_trace', team);

      const { rows: heads } = await client.query(
        `SELECT t.name AS treatment_name,
                p.given_name AS patient_given, p.family_name AS patient_family,
                r.locale AS response_locale, r.submitted_at::text AS submitted_at,
                s.name AS survey_name,
                sa.given_name AS assignee_given, sa.family_name AS assignee_family,
                a.assigned_at::text AS assigned_at,
                ab.given_name AS assigned_by_given, ab.family_name AS assigned_by_family,
                a.acknowledged_at::text AS acknowledged_at,
                ka.given_name AS acknowledged_given, ka.family_name AS acknowledged_family,
                a.resolved_at::text AS resolved_at,
                ra.given_name AS resolved_given, ra.family_name AS resolved_family
           FROM clinical.alert a
           JOIN clinical.treatment t ON t.id = a.treatment_id
           JOIN identity.patient_account p ON p.id = a.patient_id
           LEFT JOIN clinical.survey_response r ON r.id = a.survey_response_id
           LEFT JOIN clinical.survey_version v ON v.id = r.survey_version_id
           LEFT JOIN clinical.survey s ON s.id = v.survey_id
           LEFT JOIN identity.staff_account sa ON sa.id = a.assignee_id
           LEFT JOIN identity.staff_account ab ON ab.id = a.assigned_by
           LEFT JOIN identity.staff_account ka ON ka.id = a.acknowledged_by
           LEFT JOIN identity.staff_account ra ON ra.id = a.resolved_by
          WHERE a.id = $1`,
        [alertId],
      );
      const head = heads[0] as Record<string, unknown>;

      const { rows: triggerRows } = await client.query(
        `SELECT rt.id, rt.rule_id, rt.question_id, rt.severity, rt.trace,
                rt.fired_at::text AS fired_at, v.locales
           FROM clinical.rule_trigger rt
           JOIN clinical.survey_version v ON v.id = rt.survey_version_id
          WHERE rt.alert_id = $1
          ORDER BY ${"CASE rt.severity WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END"} DESC, rt.rule_id`,
        [alertId],
      );
      const responseLocale = (head['response_locale'] as string | null) ?? 'en';
      const triggers = (
        triggerRows as {
          id: string;
          rule_id: string;
          question_id: string;
          severity: string | null;
          trace: RuleTrace;
          fired_at: string;
          locales: LocaleBundle[];
        }[]
      ).map((row) => ({
        id: row.id,
        rule_id: row.rule_id,
        severity: row.severity,
        fired_at: row.fired_at,
        citation: citeTrigger(row.trace, row.locales, responseLocale),
      }));

      const { rows: comments } = await client.query(
        `SELECT c.id, c.body, c.created_at::text AS created_at,
                s.given_name AS author_given, s.family_name AS author_family
           FROM clinical.alert_comment c
           JOIN identity.staff_account s ON s.id = c.author_id
          WHERE c.alert_id = $1
          ORDER BY c.created_at`,
        [alertId],
      );

      const { rows: teamRows } = await client.query(
        `SELECT ts.staff_id, ts.is_lead, s.given_name, s.family_name, s.title
           FROM app.treatment_staff($1) ts
           JOIN identity.staff_account s ON s.id = ts.staff_id
          ORDER BY ts.is_lead DESC, s.family_name, s.given_name`,
        [alert.treatment_id],
      );

      return { alert: { ...alert, ...head }, triggers, comments, team: teamRows };
    });
  }

  /** new -> acknowledged; the compare-and-set decides the race. */
  async acknowledge(staff: StaffPrincipal, alertId: string): Promise<{ status: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const alert = await this.loadAlert(client, alertId);
      const team = await this.teamOf(client, alert.treatment_id);
      await this.decideOn(client, staff, alert, 'acknowledge', team);
      if (alert.status === 'resolved') throw new BadRequestException({ status: 'alert_resolved' });
      const result = await client.query(
        `UPDATE clinical.alert
            SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2
          WHERE id = $1 AND status = 'new'`,
        [alertId, staff.userId],
      );
      if (result.rowCount === 0) throw new ConflictException({ status: 'already_acknowledged' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'alert.acknowledge',
        resourceType: 'alert',
        resourceId: alertId,
        patientId: alert.patient_id,
        detail: { severity: alert.severity },
      });
      return { status: 'acknowledged' };
    });
  }

  async assign(
    staff: StaffPrincipal,
    alertId: string,
    assigneeId: string,
  ): Promise<{ assigneeId: string }> {
    if (!assigneeId) throw new BadRequestException({ status: 'assignee_required' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const alert = await this.loadAlert(client, alertId);
      const team = await this.teamOf(client, alert.treatment_id);
      await this.decideOn(client, staff, alert, 'assign', team);
      if (alert.status === 'resolved') throw new BadRequestException({ status: 'alert_resolved' });
      if (!team.includes(assigneeId)) {
        throw new BadRequestException({ status: 'assignee_not_on_team' });
      }
      await client.query(
        `UPDATE clinical.alert
            SET assignee_id = $2, assigned_at = now(), assigned_by = $3
          WHERE id = $1`,
        [alertId, assigneeId, staff.userId],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'alert.assign',
        resourceType: 'alert',
        resourceId: alertId,
        patientId: alert.patient_id,
        detail: { to: assigneeId },
      });
      return { assigneeId };
    });
  }

  /** Any open state may resolve - triage often closes a low-severity
   * alert in one step. Resolution is terminal. */
  async resolve(staff: StaffPrincipal, alertId: string): Promise<{ status: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const alert = await this.loadAlert(client, alertId);
      const team = await this.teamOf(client, alert.treatment_id);
      await this.decideOn(client, staff, alert, 'resolve', team);
      const result = await client.query(
        `UPDATE clinical.alert
            SET status = 'resolved', resolved_at = now(), resolved_by = $2
          WHERE id = $1 AND status <> 'resolved'`,
        [alertId, staff.userId],
      );
      if (result.rowCount === 0) throw new ConflictException({ status: 'already_resolved' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'alert.resolve',
        resourceType: 'alert',
        resourceId: alertId,
        patientId: alert.patient_id,
        detail: { severity: alert.severity },
      });
      return { status: 'resolved' };
    });
  }

  /** Append-only; the body is clinical content and stays OUT of the audit
   * detail - the change event records that a comment happened, not what
   * it said. */
  async comment(
    staff: StaffPrincipal,
    alertId: string,
    body: string,
  ): Promise<{ commentId: string }> {
    const trimmed = body?.trim() ?? '';
    if (trimmed === '') throw new BadRequestException({ status: 'body_required' });
    if (trimmed.length > 4000) throw new BadRequestException({ status: 'body_too_long' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const alert = await this.loadAlert(client, alertId);
      const team = await this.teamOf(client, alert.treatment_id);
      await this.decideOn(client, staff, alert, 'comment', team);
      const commentId = randomUUID();
      await client.query(
        `INSERT INTO clinical.alert_comment (id, alert_id, patient_id, author_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [commentId, alertId, alert.patient_id, staff.userId, trimmed],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'alert.comment',
        resourceType: 'alert',
        resourceId: alertId,
        patientId: alert.patient_id,
        detail: { commentId },
      });
      return { commentId };
    });
  }
}
