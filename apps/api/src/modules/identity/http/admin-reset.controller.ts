import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import type { Role } from '@mio/authz';
import { writeAccessEvent, writeAuthEvent } from '@mio/db';
import type { AuthService } from '../domain/auth.service.js';
import type { OnboardingService } from '../domain/onboarding.service.js';
import { verifyPassword } from '../domain/passwords.js';
import { readSessionCookie } from './cookies.js';
import { APP_POOL } from '../../../shared/db.module.js';
import {
  PATIENT_AUTH,
  PATIENT_ONBOARDING,
  STAFF_AUTH,
  STAFF_ONBOARDING,
} from '../identity.tokens.js';

/**
 * Administrator reset (A1): clears sessions, dead-letters credentials and
 * sends a fresh password-setup link - NEVER the person's data. This is the
 * first live Cedar decision point: staff_account.reset_credentials /
 * patient_account.reset_credentials are administrator-only in the matrix,
 * the decision writes its access event in the same transaction (allow AND
 * deny), and step-up re-authentication is required on top of the session.
 */
@Controller('api/staff/admin')
export class AdminResetController {
  constructor(
    @Inject(STAFF_AUTH) private readonly staffAuth: AuthService,
    @Inject(PATIENT_AUTH) private readonly patientAuth: AuthService,
    @Inject(STAFF_ONBOARDING) private readonly staffOnboarding: OnboardingService,
    @Inject(PATIENT_ONBOARDING) private readonly patientOnboarding: OnboardingService,
    @Inject(APP_POOL) private readonly pool: pg.Pool,
  ) {}

  @Post('accounts/:realm/:id/reset-login')
  @HttpCode(200)
  async resetLogin(
    @Param('realm') realm: string,
    @Param('id') accountId: string,
    @Body() body: { currentPassword?: string },
    @Req() request: FastifyRequest,
  ): Promise<object> {
    if (realm !== 'patient' && realm !== 'staff') {
      throw new NotFoundException({ status: 'unknown_realm' });
    }

    const session = await this.staffAuth.validateSession(readSessionCookie(request, 'staff'));
    if (session.status !== 'active') throw new UnauthorizedException({ status: 'none' });
    const actorRoles = (session.account.roles ?? []) as Role[];
    if (actorRoles.length === 0) throw new UnauthorizedException({ status: 'none' });
    if (realm === 'staff' && accountId === session.account.id) {
      // Never self-targeting (2026-08-25): the admin plane cannot mint a
      // fresh credential link for the very session using it. 'Forgot
      // password' is the personal path.
      throw new ForbiddenException({ status: 'cannot_target_self' });
    }

    // Step-up: the administrator proves presence with their password again.
    const stepUpOk =
      session.account.password_hash !== null &&
      (await verifyPassword(session.account.password_hash, body.currentPassword ?? ''));

    const decision = authorize({
      principal: { userId: session.account.id, roles: actorRoles },
      action: 'reset_credentials',
      resource: { type: `${realm}_account`, id: accountId },
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (decision.audit === 'always') {
        await writeAccessEvent(client, {
          actorUserId: decision.accessEvent.actorUserId,
          actorRealm: decision.accessEvent.actorRealm,
          action: decision.accessEvent.action,
          resourceType: decision.accessEvent.resourceType,
          resourceId: decision.accessEvent.resourceId,
          patientId: realm === 'patient' ? accountId : null,
          decision: stepUpOk ? decision.decision : 'deny',
        });
      }
      if (decision.decision !== 'allow' || !stepUpOk) {
        await client.query('COMMIT');
        throw new ForbiddenException({
          status: stepUpOk ? 'forbidden' : 'step_up_required',
        });
      }

      const targetAuth = realm === 'patient' ? this.patientAuth : this.staffAuth;
      const target = await targetAuth.findById(client, accountId);
      if (!target) {
        await client.query('COMMIT');
        throw new NotFoundException({ status: 'unknown_account' });
      }

      // Credentials only, never data: void the password, kill sessions and
      // outstanding tokens; the account returns to invited. The table name
      // is resolved OUTSIDE the SQL so the one-realm-per-statement tripwire
      // holds for this file too.
      const accountTable =
        realm === 'patient' ? 'identity.patient_account' : ('identity.staff_account' as const);
      await client.query(
        `UPDATE ${accountTable}
           SET password_hash = NULL, password_set_at = NULL, status = 'invited',
               failed_login_count = 0, next_login_allowed_at = NULL
         WHERE id = $1`,
        [accountId],
      );
      await targetAuth.revokeAllSessions(client, accountId);
      await client.query(
        `UPDATE identity.credential_token SET consumed_at = now()
         WHERE realm = $1 AND account_id = $2 AND consumed_at IS NULL`,
        [realm, accountId],
      );
      await writeAuthEvent(client, {
        realm,
        accountId,
        event: 'admin_reset_login',
        detail: { byStaffId: session.account.id },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      throw error;
    } finally {
      client.release();
    }

    // Fresh setup link through the invite machinery (re-invite of the
    // existing account), mailed with the admin-reset wording.
    const onboarding = realm === 'patient' ? this.patientOnboarding : this.staffOnboarding;
    const target = await this.lookupEmail(realm, accountId);
    // The invite path reuses the existing account; roles stay untouched.
    await onboarding.createInvite({
      email: target.email,
      givenName: target.given_name,
      familyName: target.family_name,
      locale: target.locale,
    });
    return { status: 'reset' };
  }

  private async lookupEmail(
    realm: 'patient' | 'staff',
    accountId: string,
  ): Promise<{
    email: string;
    given_name: string;
    family_name: string;
    locale: 'en' | 'fi' | 'sv';
  }> {
    const auth = realm === 'patient' ? this.patientAuth : this.staffAuth;
    const client = await this.pool.connect();
    try {
      const account = await auth.findById(client, accountId);
      if (!account) throw new NotFoundException({ status: 'unknown_account' });
      return account;
    } finally {
      client.release();
    }
  }
}
