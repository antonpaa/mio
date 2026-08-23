import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize, type ResourceSlice } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import { APP_POOL } from '../../shared/db.module.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * Treatments (WP-11): templates with immutable published versions,
 * per-patient instantiation with provenance, lifecycle transitions, the
 * treatment care team, and - inside the SAME transaction as every team or
 * creation change - the care-relationship sync that authorization stands
 * on. Pattern per docs/architecture/authorization.md throughout.
 */

export type TreatmentState = 'draft' | 'active' | 'paused' | 'completed' | 'discontinued';

const LEGAL_TRANSITIONS: Record<TreatmentState, TreatmentState[]> = {
  draft: ['active', 'discontinued'],
  active: ['paused', 'completed', 'discontinued'],
  paused: ['active', 'completed', 'discontinued'],
  completed: [],
  discontinued: [],
};

interface TreatmentRow {
  id: string;
  patient_id: string;
  template_version_id: string | null;
  name: string;
  detail: string;
  state: TreatmentState;
  modified_from_template: boolean;
  started_at: Date | null;
}

@Injectable()
export class TreatmentsService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  // ---- helpers ----------------------------------------------------------

  private async decideAndAudit(
    client: pg.ClientBase,
    staff: StaffPrincipal,
    action: string,
    resource: ResourceSlice,
  ): Promise<'allow' | 'deny'> {
    const decision = authorize({
      principal: { userId: staff.userId, role: staff.role },
      action,
      resource,
    });
    if (decision.audit === 'always') {
      await writeAccessEvent(client, {
        actorUserId: decision.accessEvent.actorUserId,
        actorRealm: decision.accessEvent.actorRealm,
        action: decision.accessEvent.action,
        resourceType: decision.accessEvent.resourceType,
        resourceId: decision.accessEvent.resourceId,
        patientId: decision.accessEvent.patientId,
        decision: decision.decision,
      });
    }
    return decision.decision;
  }

  private async treatmentSlice(
    client: pg.ClientBase,
    treatmentId: string,
  ): Promise<{ row: TreatmentRow; slice: ResourceSlice } | undefined> {
    const { rows } = await client.query<TreatmentRow>(
      `SELECT id, patient_id, template_version_id, name, detail, state,
              modified_from_template, started_at
         FROM clinical.treatment WHERE id = $1`,
      [treatmentId],
    );
    const row = rows[0];
    if (!row) return undefined;
    const { rows: staffRows } = await client.query<{ staff_id: string; is_lead: boolean }>(
      `SELECT staff_id, is_lead FROM app.treatment_staff($1)`,
      [treatmentId],
    );
    return {
      row,
      slice: {
        type: 'treatment',
        id: row.id,
        patientId: row.patient_id,
        teamUserIds: staffRows.map((member) => member.staff_id),
        leadUserIds: staffRows.filter((member) => member.is_lead).map((member) => member.staff_id),
      },
    };
  }

  // ---- templates (T2) ----------------------------------------------------

  async listTemplates(staff: StaffPrincipal): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      // Catalogue content: audit 'never' per the matrix; Cedar still gates.
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: { type: 'treatment_template', id: 'catalog' },
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT t.id, t.name, t.detail,
                v.id AS version_id, v.version, v.state,
                (SELECT count(*)::int FROM clinical.treatment tr
                  WHERE tr.template_version_id IN
                    (SELECT id FROM clinical.treatment_template_version WHERE template_id = t.id)
                ) AS in_use
           FROM clinical.treatment_template t
           JOIN clinical.treatment_template_version v ON v.template_id = t.id
          ORDER BY t.name, v.version DESC`,
      );
      return rows;
    });
  }

  async createTemplate(
    staff: StaffPrincipal,
    input: { name: string; detail?: string },
  ): Promise<{ templateId: string; versionId: string }> {
    if (!input.name?.trim()) throw new BadRequestException({ status: 'name_required' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = await this.decideAndAudit(client, staff, 'create', {
        type: 'treatment_template',
        id: 'new',
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO clinical.treatment_template (name, detail, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [input.name.trim(), input.detail ?? '', staff.userId],
      );
      const templateId = rows[0]!.id;
      const { rows: versionRows } = await client.query<{ id: string }>(
        `INSERT INTO clinical.treatment_template_version (template_id, version, created_by)
         VALUES ($1, 1, $2) RETURNING id`,
        [templateId, staff.userId],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment_template.create',
        resourceType: 'treatment_template',
        resourceId: templateId,
        patientId: null,
      });
      return { templateId, versionId: versionRows[0]!.id };
    });
  }

  async publishVersion(staff: StaffPrincipal, versionId: string): Promise<void> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = await this.decideAndAudit(client, staff, 'publish', {
        type: 'treatment_template',
        id: versionId,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rowCount } = await client.query(
        `UPDATE clinical.treatment_template_version
            SET state = 'published', published_at = now()
          WHERE id = $1 AND state = 'draft'`,
        [versionId],
      );
      if (rowCount === 0) throw new BadRequestException({ status: 'not_a_draft' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment_template.publish',
        resourceType: 'treatment_template_version',
        resourceId: versionId,
        patientId: null,
      });
    });
  }

  /** Editing a published version = creating the next draft (immutability). */
  async newDraftFrom(
    staff: StaffPrincipal,
    versionId: string,
    definition?: object,
  ): Promise<{ versionId: string; version: number }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = await this.decideAndAudit(client, staff, 'update_draft', {
        type: 'treatment_template',
        id: versionId,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query<{ template_id: string; state: string }>(
        `SELECT template_id, state FROM clinical.treatment_template_version WHERE id = $1`,
        [versionId],
      );
      const source = rows[0];
      if (!source) throw new NotFoundException({ status: 'unknown_version' });
      if (source.state === 'draft') throw new BadRequestException({ status: 'already_draft' });
      const { rows: next } = await client.query<{ id: string; version: number }>(
        `INSERT INTO clinical.treatment_template_version (template_id, version, definition, created_by)
         SELECT template_id, max(version) + 1,
                coalesce($2::jsonb, (SELECT definition FROM clinical.treatment_template_version WHERE id = $1)),
                $3
           FROM clinical.treatment_template_version
          WHERE template_id = (SELECT template_id FROM clinical.treatment_template_version WHERE id = $1)
          GROUP BY template_id
          RETURNING id, version`,
        [versionId, definition !== undefined ? JSON.stringify(definition) : null, staff.userId],
      );
      return { versionId: next[0]!.id, version: next[0]!.version };
    });
  }

  // ---- treatments (T1) ---------------------------------------------------

  /** Instantiate a template for a patient - a COPY, freely modifiable;
   * template updates never change running treatments (T2). Creator becomes
   * the first lead, and the care graph syncs in the same transaction. */
  async instantiate(
    staff: StaffPrincipal,
    input: { templateVersionId: string; patientId: string; name?: string },
  ): Promise<{ treatmentId: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = await this.decideAndAudit(client, staff, 'create', {
        type: 'treatment',
        id: 'new',
        patientId: input.patientId,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const { rows: versionRows } = await client.query<{
        id: string;
        name: string;
        detail: string;
        state: string;
      }>(
        `SELECT v.id, t.name, t.detail, v.state
           FROM clinical.treatment_template_version v
           JOIN clinical.treatment_template t ON t.id = v.template_id
          WHERE v.id = $1`,
        [input.templateVersionId],
      );
      const version = versionRows[0];
      if (!version) throw new NotFoundException({ status: 'unknown_version' });
      if (version.state !== 'published') {
        throw new BadRequestException({ status: 'version_not_published' });
      }

      // Id generated client-side: RETURNING would require the fresh row to
      // pass the SELECT policy, and the creator's care relationship only
      // exists AFTER the care-team insert + sync below.
      const treatmentId = randomUUID();
      await client.query(
        `INSERT INTO clinical.treatment (id, patient_id, template_version_id, name, detail, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          treatmentId,
          input.patientId,
          version.id,
          input.name?.trim() || version.name,
          version.detail,
          staff.userId,
        ],
      );
      await client.query(
        `INSERT INTO clinical.treatment_care_team (treatment_id, staff_id, role, added_by)
         VALUES ($1, $2, 'lead', $2)`,
        [treatmentId, staff.userId],
      );
      await client.query(`SELECT app.sync_care_relationships($1)`, [treatmentId]);
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.create',
        resourceType: 'treatment',
        resourceId: treatmentId,
        patientId: input.patientId,
        detail: { templateVersionId: version.id },
      });
      return { treatmentId };
    });
  }

  async detail(staff: StaffPrincipal, treatmentId: string): Promise<object> {
    const result = await withUserContext(
      this.pool,
      { userId: staff.userId, realm: 'staff' },
      async (client): Promise<object | 'denied' | 'missing'> => {
        const found = await this.treatmentSlice(client, treatmentId);
        if (!found) return 'missing';
        const decision = authorize({
          principal: { userId: staff.userId, role: staff.role },
          action: 'view',
          resource: found.slice,
        });
        if (decision.decision !== 'allow') return 'denied';
        await writeAccessEvent(client, {
          actorUserId: staff.userId,
          actorRealm: 'staff',
          action: 'treatment.view',
          resourceType: 'treatment',
          resourceId: treatmentId,
          patientId: found.row.patient_id,
          decision: 'allow',
        });
        const { rows: members } = await client.query(
          `SELECT ct.id, ct.staff_id, ct.team_id, ct.role,
                  s.given_name AS staff_given, s.family_name AS staff_family, s.title,
                  tm.name AS team_name,
                  (SELECT count(*)::int FROM identity.team_membership m WHERE m.team_id = ct.team_id) AS team_size
             FROM clinical.treatment_care_team ct
             LEFT JOIN identity.staff_account s ON s.id = ct.staff_id
             LEFT JOIN identity.team tm ON tm.id = ct.team_id
            WHERE ct.treatment_id = $1 AND ct.removed_at IS NULL
            ORDER BY ct.role DESC, s.family_name NULLS LAST`,
          [treatmentId],
        );
        const { rows: provenance } = await client.query(
          `SELECT t.name AS template_name, v.version
             FROM clinical.treatment_template_version v
             JOIN clinical.treatment_template t ON t.id = v.template_id
            WHERE v.id = $1`,
          [found.row.template_version_id],
        );
        return {
          id: found.row.id,
          patientId: found.row.patient_id,
          name: found.row.name,
          detail: found.row.detail,
          state: found.row.state,
          modifiedFromTemplate: found.row.modified_from_template,
          template: provenance[0] ?? null,
          team: members,
          legalTransitions: LEGAL_TRANSITIONS[found.row.state],
        };
      },
    );
    if (result === 'missing') throw new NotFoundException({ status: 'unknown_treatment' });
    if (result === 'denied') {
      await this.auditDenied(staff, 'treatment.view', treatmentId);
      throw new ForbiddenException({ status: 'forbidden' });
    }
    return result;
  }

  private async auditDenied(
    staff: StaffPrincipal,
    action: string,
    resourceId: string,
  ): Promise<void> {
    await withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, (client) =>
      writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action,
        resourceType: action.split('.')[0] ?? 'treatment',
        resourceId,
        patientId: null,
        decision: 'deny',
      }),
    );
  }

  async changeState(
    staff: StaffPrincipal,
    treatmentId: string,
    to: TreatmentState,
  ): Promise<{ state: TreatmentState }> {
    const result = await withUserContext(
      this.pool,
      { userId: staff.userId, realm: 'staff' },
      async (client): Promise<{ state: TreatmentState } | 'denied' | 'missing' | 'illegal'> => {
        const found = await this.treatmentSlice(client, treatmentId);
        if (!found) return 'missing';
        const decision = authorize({
          principal: { userId: staff.userId, role: staff.role },
          action: 'change_lifecycle_state',
          resource: found.slice,
        });
        await writeAccessEvent(client, {
          actorUserId: staff.userId,
          actorRealm: 'staff',
          action: 'treatment.change_lifecycle_state',
          resourceType: 'treatment',
          resourceId: treatmentId,
          patientId: found.row.patient_id,
          decision: decision.decision,
        });
        if (decision.decision !== 'allow') {
          // deny must be durable; roll nothing else back - the event above
          // is the only write in this transaction on the deny path.
          return 'denied';
        }
        if (!LEGAL_TRANSITIONS[found.row.state].includes(to)) return 'illegal';
        await client.query(
          `UPDATE clinical.treatment
              SET state = $2, state_changed_at = now(),
                  started_at = CASE WHEN $2 = 'active' AND started_at IS NULL THEN now() ELSE started_at END
            WHERE id = $1`,
          [treatmentId, to],
        );
        await writeChangeEvent(client, {
          actorUserId: staff.userId,
          actorRealm: 'staff',
          action: 'treatment.change_lifecycle_state',
          resourceType: 'treatment',
          resourceId: treatmentId,
          patientId: found.row.patient_id,
          detail: { from: found.row.state, to },
        });
        return { state: to };
      },
    );
    if (result === 'missing') throw new NotFoundException({ status: 'unknown_treatment' });
    if (result === 'denied') throw new ForbiddenException({ status: 'forbidden' });
    if (result === 'illegal') throw new BadRequestException({ status: 'illegal_transition' });
    return result;
  }

  async addTeamEntry(
    staff: StaffPrincipal,
    treatmentId: string,
    entry: { staffId?: string; teamId?: string; role?: 'member' | 'lead' },
  ): Promise<void> {
    if (!entry.staffId === !entry.teamId) {
      throw new BadRequestException({ status: 'exactly_one_of_staff_or_team' });
    }
    const result = await withUserContext(
      this.pool,
      { userId: staff.userId, realm: 'staff' },
      async (client): Promise<'ok' | 'denied' | 'missing'> => {
        const found = await this.treatmentSlice(client, treatmentId);
        if (!found) return 'missing';
        const decision = authorize({
          principal: { userId: staff.userId, role: staff.role },
          action: 'manage_team',
          resource: found.slice,
        });
        await writeAccessEvent(client, {
          actorUserId: staff.userId,
          actorRealm: 'staff',
          action: 'treatment.manage_team',
          resourceType: 'treatment',
          resourceId: treatmentId,
          patientId: found.row.patient_id,
          decision: decision.decision,
        });
        if (decision.decision !== 'allow') return 'denied';
        await client.query(
          `INSERT INTO clinical.treatment_care_team (treatment_id, staff_id, team_id, role, added_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            treatmentId,
            entry.staffId ?? null,
            entry.teamId ?? null,
            entry.role ?? 'member',
            staff.userId,
          ],
        );
        await client.query(`SELECT app.sync_care_relationships($1)`, [treatmentId]);
        await writeChangeEvent(client, {
          actorUserId: staff.userId,
          actorRealm: 'staff',
          action: 'treatment.manage_team',
          resourceType: 'treatment',
          resourceId: treatmentId,
          patientId: found.row.patient_id,
          detail: { added: entry },
        });
        return 'ok';
      },
    );
    if (result === 'missing') throw new NotFoundException({ status: 'unknown_treatment' });
    if (result === 'denied') throw new ForbiddenException({ status: 'forbidden' });
  }

  /** PP1: a patient's programs, care-relationship gated. */
  async forPatient(staff: StaffPrincipal, patientId: string): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows: teamRows } = await client.query<{ team: string[] }>(
        `SELECT app.care_team_of($1) AS team`,
        [patientId],
      );
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: {
          type: 'treatment',
          id: `patient-${patientId}`,
          patientId,
          teamUserIds: teamRows[0]?.team ?? [],
          leadUserIds: [],
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.view',
        resourceType: 'treatment_list',
        resourceId: patientId,
        patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT t.id, t.name, t.detail, t.state, t.started_at,
                v.version, tt.name AS template_name
           FROM clinical.treatment t
           LEFT JOIN clinical.treatment_template_version v ON v.id = t.template_version_id
           LEFT JOIN clinical.treatment_template tt ON tt.id = v.template_id
          WHERE t.patient_id = $1
          ORDER BY t.state = 'active' DESC, t.created_at DESC`,
        [patientId],
      );
      return rows;
    });
  }

  /** P5: the patient's own treatments with the display team. */
  async ownTreatments(patientUserId: string): Promise<object[]> {
    return withUserContext(
      this.pool,
      { userId: patientUserId, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query(
          `SELECT t.id, t.name, t.detail, t.state, t.started_at
             FROM clinical.treatment t
            WHERE t.patient_id = $1
            ORDER BY t.state = 'active' DESC, t.created_at DESC`,
          [patientUserId],
        );
        await writeAccessEvent(client, {
          actorUserId: patientUserId,
          actorRealm: 'patient',
          action: 'treatment.view',
          resourceType: 'treatment_list',
          resourceId: patientUserId,
          patientId: patientUserId,
          decision: 'allow',
        });
        const treatments = [];
        for (const row of rows as {
          id: string;
          name: string;
          detail: string;
          state: string;
          started_at: Date | null;
        }[]) {
          const { rows: team } = await client.query(
            `SELECT s.given_name, s.family_name, s.title, ts.is_lead
               FROM app.treatment_staff($1) ts
               JOIN identity.staff_account s ON s.id = ts.staff_id
              ORDER BY ts.is_lead DESC, s.family_name`,
            [row.id],
          );
          treatments.push({ ...row, team });
        }
        return treatments;
      },
    );
  }
}
