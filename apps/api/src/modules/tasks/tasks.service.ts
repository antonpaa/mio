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
import { APP_POOL } from '../../shared/db.module.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * Tasks (WP-13, design C5): clinician work items on a treatment. NULL
 * assignee is the TEAM QUEUE; claiming is a race-safe compare-and-set.
 * Completion writes the change event the treatment activity log renders.
 * Same decision pattern as every clinical module: scope in SQL, decide in
 * Cedar, audit in the same transaction.
 */

export interface TaskRow {
  id: string;
  treatment_id: string;
  patient_id: string;
  activity_id: string | null;
  title: string;
  detail: string;
  due_date: string | null;
  status: 'open' | 'completed';
  assignee_id: string | null;
  treatment_name?: string;
  patient_given?: string;
  patient_family?: string;
  assignee_given?: string | null;
  assignee_family?: string | null;
  /** whether the CALLER holds the lead position on this task's treatment
   * (task.complete is own OR team_lead - the button follows the truth) */
  viewer_is_lead?: boolean;
}

const TASK_COLUMNS = `
  k.id, k.treatment_id, k.patient_id, k.activity_id, k.title, k.detail,
  k.due_date::text AS due_date, k.status, k.assignee_id,
  t.name AS treatment_name,
  p.given_name AS patient_given, p.family_name AS patient_family,
  a.given_name AS assignee_given, a.family_name AS assignee_family`;

const TASK_JOINS = `
  FROM clinical.task k
  JOIN clinical.treatment t ON t.id = k.treatment_id
  JOIN identity.patient_account p ON p.id = k.patient_id
  LEFT JOIN identity.staff_account a ON a.id = k.assignee_id`;

@Injectable()
export class TasksService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  private async treatmentContext(
    client: pg.ClientBase,
    treatmentId: string,
  ): Promise<{ patientId: string; teamUserIds: string[]; leadUserIds: string[] } | undefined> {
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
    return {
      patientId: treatment.patient_id,
      teamUserIds: staffRows.map((row) => row.staff_id),
      leadUserIds: staffRows.filter((row) => row.is_lead).map((row) => row.staff_id),
    };
  }

  /** C5: every open task across the caller's treatments, one worklist. A
   * worklist names patients, so the disclosure is audited as ONE list-level
   * event carrying the patient ids (matrix: task.view, audit always). */
  async worklist(staff: StaffPrincipal): Promise<TaskRow[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query<TaskRow>(
        `SELECT ${TASK_COLUMNS},
                EXISTS (SELECT 1 FROM app.treatment_staff(k.treatment_id) tl
                         WHERE tl.staff_id = $1 AND tl.is_lead) AS viewer_is_lead
           ${TASK_JOINS}
          WHERE k.status = 'open'
            AND EXISTS (SELECT 1 FROM app.treatment_staff(k.treatment_id) ts
                         WHERE ts.staff_id = $1)
          ORDER BY k.due_date NULLS LAST, k.created_at`,
        [staff.userId],
      );
      // Spot-check the scoping with the decision point: the caller is on
      // every row's team by construction; a deny means scoping and policy
      // disagree - fail loud, never leak.
      for (const row of rows) {
        const decision = authorize({
          principal: { userId: staff.userId, roles: staff.roles },
          action: 'view',
          resource: {
            type: 'task',
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
        action: 'task.view',
        resourceType: 'task_worklist',
        resourceId: null,
        patientId: null,
        decision: 'allow',
        context: { patientIds: [...new Set(rows.map((row) => row.patient_id))] },
      });
      return rows;
    });
  }

  /** T1: the one treatment's tasks, open first. */
  async listForTreatment(staff: StaffPrincipal, treatmentId: string): Promise<TaskRow[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, roles: staff.roles },
        action: 'view',
        resource: {
          type: 'task',
          id: treatmentId,
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.view',
        resourceType: 'task_list',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query<TaskRow>(
        `SELECT ${TASK_COLUMNS},
                EXISTS (SELECT 1 FROM app.treatment_staff($1) tl
                         WHERE tl.staff_id = $2 AND tl.is_lead) AS viewer_is_lead
           ${TASK_JOINS}
          WHERE k.treatment_id = $1
          ORDER BY k.status, k.due_date NULLS LAST, k.created_at`,
        [treatmentId, staff.userId],
      );
      return rows;
    });
  }

  /** The treatment's resolved staff - the assign dropdown. */
  async treatmentStaff(staff: StaffPrincipal, treatmentId: string): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, roles: staff.roles },
        action: 'view',
        resource: {
          type: 'treatment',
          id: treatmentId,
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
          leadUserIds: context.leadUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.view',
        resourceType: 'treatment_staff',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT ts.staff_id, ts.is_lead, s.given_name, s.family_name, s.title
           FROM app.treatment_staff($1) ts
           JOIN identity.staff_account s ON s.id = ts.staff_id
          ORDER BY ts.is_lead DESC, s.family_name, s.given_name`,
        [treatmentId],
      );
      return rows;
    });
  }

  async createTask(
    staff: StaffPrincipal,
    treatmentId: string,
    input: {
      title: string;
      detail?: string;
      dueDate?: string;
      assigneeId?: string;
      activityId?: string;
    },
  ): Promise<{ taskId: string }> {
    if (!input.title?.trim()) throw new BadRequestException({ status: 'title_required' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, roles: staff.roles },
        action: 'create',
        resource: {
          type: 'task',
          id: 'new',
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.create',
        resourceType: 'task',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      if (input.assigneeId !== undefined && !context.teamUserIds.includes(input.assigneeId)) {
        throw new BadRequestException({ status: 'assignee_not_on_team' });
      }
      const taskId = randomUUID();
      await client.query(
        `INSERT INTO clinical.task
           (id, treatment_id, patient_id, activity_id, title, detail, due_date, assignee_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          taskId,
          treatmentId,
          context.patientId,
          input.activityId ?? null,
          input.title.trim(),
          input.detail?.trim() ?? '',
          input.dueDate ?? null,
          input.assigneeId ?? null,
          staff.userId,
        ],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.create',
        resourceType: 'task',
        resourceId: taskId,
        patientId: context.patientId,
        detail: { treatmentId, assigned: input.assigneeId !== undefined },
      });
      return { taskId };
    });
  }

  private async loadOpenTask(client: pg.ClientBase, taskId: string): Promise<TaskRow> {
    const { rows } = await client.query<TaskRow>(
      `SELECT k.id, k.treatment_id, k.patient_id, k.activity_id, k.title, k.detail,
              k.due_date::text AS due_date, k.status, k.assignee_id
         FROM clinical.task k WHERE k.id = $1`,
      [taskId],
    );
    const task = rows[0];
    if (!task) throw new NotFoundException({ status: 'unknown_task' });
    if (task.status !== 'open') throw new BadRequestException({ status: 'task_not_open' });
    return task;
  }

  /** Claim from the team queue - first writer wins, the compare-and-set
   * UPDATE decides the race, not the read. */
  async claim(staff: StaffPrincipal, taskId: string): Promise<{ assigneeId: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const task = await this.loadOpenTask(client, taskId);
      const context = await this.treatmentContext(client, task.treatment_id);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, roles: staff.roles },
        action: 'claim',
        resource: {
          type: 'task',
          id: taskId,
          patientId: task.patient_id,
          teamUserIds: context.teamUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.claim',
        resourceType: 'task',
        resourceId: taskId,
        patientId: task.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const result = await client.query(
        `UPDATE clinical.task SET assignee_id = $2
          WHERE id = $1 AND assignee_id IS NULL AND status = 'open'`,
        [taskId, staff.userId],
      );
      if (result.rowCount === 0) throw new ConflictException({ status: 'already_claimed' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.claim',
        resourceType: 'task',
        resourceId: taskId,
        patientId: task.patient_id,
        detail: { treatmentId: task.treatment_id },
      });
      return { assigneeId: staff.userId };
    });
  }

  async assign(
    staff: StaffPrincipal,
    taskId: string,
    assigneeId: string,
  ): Promise<{ assigneeId: string }> {
    if (!assigneeId) throw new BadRequestException({ status: 'assignee_required' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const task = await this.loadOpenTask(client, taskId);
      const context = await this.treatmentContext(client, task.treatment_id);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, roles: staff.roles },
        action: 'assign_to_other',
        resource: {
          type: 'task',
          id: taskId,
          patientId: task.patient_id,
          teamUserIds: context.teamUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.assign_to_other',
        resourceType: 'task',
        resourceId: taskId,
        patientId: task.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      if (!context.teamUserIds.includes(assigneeId)) {
        throw new BadRequestException({ status: 'assignee_not_on_team' });
      }
      await client.query(`UPDATE clinical.task SET assignee_id = $2 WHERE id = $1`, [
        taskId,
        assigneeId,
      ]);
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.assign_to_other',
        resourceType: 'task',
        resourceId: taskId,
        patientId: task.patient_id,
        detail: { treatmentId: task.treatment_id, to: assigneeId },
      });
      return { assigneeId };
    });
  }

  /** Complete: matrix scope 'own' for members (only the assignee), whole
   * team for leads. The change event is the treatment activity log entry. */
  async complete(staff: StaffPrincipal, taskId: string): Promise<{ status: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const task = await this.loadOpenTask(client, taskId);
      const context = await this.treatmentContext(client, task.treatment_id);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, roles: staff.roles },
        action: 'complete',
        resource: {
          type: 'task',
          id: taskId,
          patientId: task.patient_id,
          teamUserIds: context.teamUserIds,
          // 'complete' is own OR team-lead (matrix union): the assignee
          // finishes their task; this treatment's leads can close any.
          leadUserIds: context.leadUserIds,
          ...(task.assignee_id !== null ? { ownerUserId: task.assignee_id } : {}),
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.complete',
        resourceType: 'task',
        resourceId: taskId,
        patientId: task.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      await client.query(
        `UPDATE clinical.task
            SET status = 'completed', completed_by = $2, completed_at = now()
          WHERE id = $1`,
        [taskId, staff.userId],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'task.complete',
        resourceType: 'task',
        resourceId: taskId,
        patientId: task.patient_id,
        detail: { treatmentId: task.treatment_id, title: task.title },
      });
      return { status: 'completed' };
    });
  }
}
