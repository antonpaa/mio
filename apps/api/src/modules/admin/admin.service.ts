import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { ROLE_CAPABILITIES } from '@mio/authz';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import { APP_POOL, AUDIT_READER_POOL } from '../../shared/db.module.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';
import {
  PATIENT_ONBOARDING,
  STAFF_ONBOARDING,
  verifyPassword,
  type OnboardingService,
} from '../identity/index.js';

/**
 * WP-28: the administration plane. Identity only, by construction - the
 * admin path holds no clinical grants and this module holds no clinical
 * queries. Credential resets demand STEP-UP (the administrator re-enters
 * their own password); the audit view renders X4-minimised rows: generic
 * event text, patients as initials.
 */

const STAFF_ROLES = ['treatment_member', 'treatment_lead', 'administrator', 'auditor'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

@Injectable()
export class AdminService {
  constructor(
    @Inject(APP_POOL) private readonly pool: pg.Pool,
    @Inject(AUDIT_READER_POOL) private readonly auditReader: pg.Pool,
    @Inject(STAFF_ONBOARDING) private readonly staffOnboarding: OnboardingService,
    @Inject(PATIENT_ONBOARDING) private readonly patientOnboarding: OnboardingService,
  ) {}

  private decide(staff: StaffPrincipal, resource: string, action: string): 'allow' | 'deny' {
    return authorize({
      principal: { userId: staff.userId, role: staff.role },
      action,
      resource: { type: resource, id: 'admin' },
    }).decision;
  }

  private async decideAndLog(
    client: pg.ClientBase,
    staff: StaffPrincipal,
    resource: string,
    action: string,
    resourceId: string | null,
    context?: object,
  ): Promise<void> {
    const decision = this.decide(staff, resource, action);
    await writeAccessEvent(client, {
      actorUserId: staff.userId,
      actorRealm: 'staff',
      action: `${resource}.${action}`,
      resourceType: resource,
      resourceId,
      patientId: null,
      decision,
      ...(context !== undefined ? { context } : {}),
    });
    if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
  }

  async listUsers(staff: StaffPrincipal): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, 'staff_account', 'view', null);
      await this.decideAndLog(client, staff, 'patient_account', 'view', null);
      const { rows: staffRows } = await client.query(
        `SELECT id, email, given_name, family_name, role, title, status
           FROM identity.staff_account ORDER BY family_name, given_name`,
      );
      const { rows: patientRows } = await client.query(
        `SELECT id, email, given_name, family_name, locale, status
           FROM identity.patient_account ORDER BY family_name, given_name`,
      );
      return { staff: staffRows, patients: patientRows };
    });
  }

  async createStaff(
    staff: StaffPrincipal,
    input: {
      email?: string;
      givenName?: string;
      familyName?: string;
      role?: string;
      title?: string;
      locale?: string;
    },
  ): Promise<object> {
    if (
      !input.email?.includes('@') ||
      !input.givenName?.trim() ||
      !input.familyName?.trim() ||
      !STAFF_ROLES.includes((input.role ?? '') as StaffRole)
    ) {
      throw new BadRequestException({ status: 'invalid_input' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, 'staff_account', 'create', null);
      const { accountId } = await this.staffOnboarding.createInvite({
        email: input.email!,
        givenName: input.givenName!,
        familyName: input.familyName!,
        role: input.role! as StaffRole,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.locale !== undefined ? { locale: input.locale as 'en' | 'fi' | 'sv' } : {}),
      });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'staff_account.create',
        resourceType: 'staff_account',
        resourceId: accountId,
        patientId: null,
        detail: { role: input.role },
      });
      return { accountId };
    });
  }

  /** P1 (decided 2026-08-24): identity creation is administration, for
   * patients too. The care side ENROLS an existing account into a
   * treatment; it never creates one. */
  async createPatient(
    staff: StaffPrincipal,
    input: { email?: string; givenName?: string; familyName?: string; locale?: string },
  ): Promise<object> {
    if (!input.email?.includes('@') || !input.givenName?.trim() || !input.familyName?.trim()) {
      throw new BadRequestException({ status: 'invalid_input' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, 'patient_account', 'create', null);
      const { accountId } = await this.patientOnboarding.createInvite({
        email: input.email!,
        givenName: input.givenName!,
        familyName: input.familyName!,
        ...(input.locale !== undefined ? { locale: input.locale as 'en' | 'fi' | 'sv' } : {}),
      });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'patient_account.create',
        resourceType: 'patient_account',
        resourceId: accountId,
        patientId: accountId,
      });
      return { accountId };
    });
  }

  /** Step-up: the administrator proves their own password again before
   * any credential-affecting change (matrix note on reset_credentials). */
  private async stepUp(
    client: pg.ClientBase,
    staff: StaffPrincipal,
    resource: string,
    action: string,
    targetId: string,
    password: string | undefined,
  ): Promise<void> {
    const { rows } = await client.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM identity.staff_account WHERE id = $1`,
      [staff.userId],
    );
    const ok =
      typeof password === 'string' &&
      rows[0]?.password_hash != null &&
      (await verifyPassword(rows[0].password_hash, password));
    if (!ok) {
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: `${resource}.${action}`,
        resourceType: resource,
        resourceId: targetId,
        patientId: null,
        decision: 'deny',
        context: { stepUp: 'failed' },
      });
      throw new ForbiddenException({ status: 'step_up_required' });
    }
  }

  async deactivate(
    staff: StaffPrincipal,
    realm: 'patient' | 'staff',
    accountId: string,
  ): Promise<object> {
    if (realm === 'staff' && accountId === staff.userId) {
      throw new BadRequestException({ status: 'cannot_deactivate_self' });
    }
    const resource = realm === 'staff' ? 'staff_account' : 'patient_account';
    const table = realm === 'staff' ? 'identity.staff_account' : 'identity.patient_account';
    const sessions = realm === 'staff' ? 'identity.staff_session' : 'identity.patient_session';
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, resource, 'deactivate', accountId);
      const { rowCount } = await client.query(
        `UPDATE ${table} SET status = 'deactivated' WHERE id = $1 AND status <> 'deactivated'`,
        [accountId],
      );
      if (rowCount === 0) throw new NotFoundException({ status: 'unknown_account' });
      await client.query(
        `UPDATE ${sessions} SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`,
        [accountId],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: `${resource}.deactivate`,
        resourceType: resource,
        resourceId: accountId,
        patientId: realm === 'patient' ? accountId : null,
      });
      return { deactivated: true };
    });
  }

  /** The inverse of deactivate: sign-in works again, but revoked
   * sessions stay revoked and credentials stay whatever they were. */
  async reactivate(
    staff: StaffPrincipal,
    realm: 'patient' | 'staff',
    accountId: string,
  ): Promise<object> {
    const resource = realm === 'staff' ? 'staff_account' : 'patient_account';
    const table = realm === 'staff' ? 'identity.staff_account' : 'identity.patient_account';
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, resource, 'reactivate', accountId);
      const { rowCount } = await client.query(
        `UPDATE ${table} SET status = 'active' WHERE id = $1 AND status = 'deactivated'`,
        [accountId],
      );
      if (rowCount === 0) throw new NotFoundException({ status: 'unknown_account' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: `${resource}.reactivate`,
        resourceType: resource,
        resourceId: accountId,
        patientId: realm === 'patient' ? accountId : null,
      });
      return { reactivated: true };
    });
  }

  /** Credentials only, never data: kills sessions, dead-letters open
   * tokens and mails a fresh welcome link through the contentless layer. */
  async resetLogin(
    staff: StaffPrincipal,
    realm: 'patient' | 'staff',
    accountId: string,
    adminPassword: string | undefined,
  ): Promise<object> {
    const resource = realm === 'staff' ? 'staff_account' : 'patient_account';
    const table = realm === 'staff' ? 'identity.staff_account' : 'identity.patient_account';
    const sessions = realm === 'staff' ? 'identity.staff_session' : 'identity.patient_session';
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.stepUp(client, staff, resource, 'reset_credentials', accountId, adminPassword);
      await this.decideAndLog(client, staff, resource, 'reset_credentials', accountId);
      const { rows } = await client.query<{
        email: string;
        given_name: string;
        family_name: string;
      }>(
        `SELECT email, given_name, family_name FROM ${table} WHERE id = $1 AND status = 'active'`,
        [accountId],
      );
      const account = rows[0];
      if (!account) throw new NotFoundException({ status: 'unknown_account' });
      await client.query(
        `UPDATE ${sessions} SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`,
        [accountId],
      );
      const onboarding = realm === 'staff' ? this.staffOnboarding : this.patientOnboarding;
      await onboarding.createInvite({
        email: account.email,
        givenName: account.given_name,
        familyName: account.family_name,
        // role is ignored for existing accounts - the invite path reuses them
        role: 'treatment_member',
      });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: `${resource}.reset_credentials`,
        resourceType: resource,
        resourceId: accountId,
        patientId: realm === 'patient' ? accountId : null,
      });
      return { reset: true };
    });
  }

  async teams(staff: StaffPrincipal): Promise<object[]> {
    if (this.decide(staff, 'team', 'view') !== 'allow') {
      throw new ForbiddenException({ status: 'forbidden' });
    }
    const { rows } = await this.pool.query(
      `SELECT t.id, t.name,
              COALESCE(json_agg(json_build_object(
                'id', s.id, 'given_name', s.given_name, 'family_name', s.family_name,
                'role', s.role) ORDER BY s.family_name)
                FILTER (WHERE s.id IS NOT NULL), '[]') AS members
         FROM identity.team t
         LEFT JOIN identity.team_membership m ON m.team_id = t.id
         LEFT JOIN identity.staff_account s ON s.id = m.staff_id
        GROUP BY t.id, t.name ORDER BY t.name`,
    );
    return rows as object[];
  }

  async createTeam(staff: StaffPrincipal, name: string | undefined): Promise<object> {
    if (!name?.trim()) throw new BadRequestException({ status: 'name_required' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, 'team', 'create', null);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO identity.team (id, name) VALUES (gen_random_uuid(), $1) RETURNING id`,
        [name.trim()],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'team.create',
        resourceType: 'team',
        resourceId: rows[0]!.id,
        patientId: null,
      });
      return { teamId: rows[0]!.id };
    });
  }

  async updateMembership(
    staff: StaffPrincipal,
    teamId: string,
    add: string[],
    remove: string[],
  ): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, 'team', 'update_membership', teamId, {
        add: add.length,
        remove: remove.length,
      });
      const { rows } = await client.query(`SELECT id FROM identity.team WHERE id = $1`, [teamId]);
      if (rows.length === 0) throw new NotFoundException({ status: 'unknown_team' });
      for (const staffId of add) {
        await client.query(
          `INSERT INTO identity.team_membership (team_id, staff_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [teamId, staffId],
        );
      }
      if (remove.length > 0) {
        await client.query(
          `DELETE FROM identity.team_membership WHERE team_id = $1 AND staff_id = ANY($2)`,
          [teamId, remove],
        );
      }
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'team.update_membership',
        resourceType: 'team',
        resourceId: teamId,
        patientId: null,
        detail: { added: add.length, removed: remove.length },
      });
      return { updated: true };
    });
  }

  /** A2: the role matrix RENDERED FROM the generated capabilities - the
   * screen cannot drift from the enforcement because it has no source
   * of its own. */
  roles(): object {
    return { roles: ROLE_CAPABILITIES };
  }

  /**
   * A3 (P2 decided 2026-08-24): the FULL log belongs to the dedicated
   * auditor role, and oversight is the role's purpose - so the auditor
   * sees full patient identities. The X4-minimised rendering (subjects
   * as initials) remains the shape for any OTHER role the matrix might
   * ever grant a log view to; today the matrix grants view_full to the
   * auditor alone, and every view is itself audited.
   */
  async auditLog(staff: StaffPrincipal, limit: number): Promise<object> {
    const fullIdentities = staff.role === 'auditor';
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideAndLog(client, staff, 'audit_log', 'view_full', null);
      const capped = Math.min(Math.max(limit, 1), 500);
      const { rows } = await this.auditReader.query(
        `SELECT occurred_at::text AS occurred_at, actor_user_id, actor_realm, action,
                resource_type, resource_id, patient_id, decision
           FROM audit.access_event
          ORDER BY occurred_at DESC
          LIMIT $1`,
        [capped],
      );
      const actorIds = [
        ...new Set(
          (rows as { actor_user_id: string | null }[])
            .map((row) => row.actor_user_id)
            .filter((id): id is string => id !== null),
        ),
      ];
      const patientIds = [
        ...new Set(
          (rows as { patient_id: string | null }[])
            .map((row) => row.patient_id)
            .filter((id): id is string => id !== null),
        ),
      ];
      const names = new Map<string, string>();
      if (actorIds.length > 0) {
        const { rows: staffNames } = await client.query<{
          id: string;
          given_name: string;
          family_name: string;
        }>(`SELECT id, given_name, family_name FROM identity.staff_account WHERE id = ANY($1)`, [
          actorIds,
        ]);
        for (const row of staffNames) names.set(row.id, `${row.given_name} ${row.family_name}`);
      }
      const initials = new Map<string, string>();
      if (patientIds.length > 0) {
        const { rows: patientRows } = await client.query<{
          id: string;
          given_name: string;
          family_name: string;
        }>(`SELECT id, given_name, family_name FROM identity.patient_account WHERE id = ANY($1)`, [
          patientIds,
        ]);
        for (const row of patientRows) {
          initials.set(
            row.id,
            fullIdentities
              ? `${row.given_name} ${row.family_name}`
              : `${row.given_name.slice(0, 1)}.${row.family_name.slice(0, 1)}.`,
          );
        }
      }
      return {
        events: (rows as Record<string, unknown>[]).map((row) => ({
          occurred_at: row['occurred_at'],
          actor:
            row['actor_realm'] === 'staff'
              ? (names.get(row['actor_user_id'] as string) ?? 'staff')
              : row['actor_realm'] === 'patient'
                ? (initials.get(row['actor_user_id'] as string) ??
                  (row['patient_id'] !== null
                    ? (initials.get(row['patient_id'] as string) ?? 'patient')
                    : 'patient'))
                : 'system',
          actor_realm: row['actor_realm'],
          action: row['action'],
          resource_type: row['resource_type'],
          subject: row['patient_id'] !== null ? initials.get(row['patient_id'] as string) : null,
          decision: row['decision'],
        })),
      };
    });
  }
}
