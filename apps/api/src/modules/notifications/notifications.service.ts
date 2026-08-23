import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import { APP_POOL } from '../../shared/db.module.js';
import type { PatientPrincipal } from '../../shared/patient-session.js';

/**
 * P11 + the P8 email-toggle slice (WP-25). The centre lists rows the
 * system dispatch addressed to THIS recipient - the in-app layer may
 * carry clinical content, which is exactly why nobody else reads it.
 * Reading is the audited disclosure; marking read is recording
 * attention (matrix: audit never). Email toggles switch only the
 * contentless nudge - in-app delivery is not optional.
 */

/** The per-type email toggles P8 exposes; absent = on. */
const EMAIL_PREF_KINDS = ['message.new', 'rule.notify', 'survey_reminder'] as const;

@Injectable()
export class NotificationsService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  private decide(patient: PatientPrincipal, action: 'view' | 'mark_read'): 'allow' | 'deny' {
    return authorize({
      principal: { userId: patient.userId, role: 'patient' },
      action,
      resource: {
        type: 'notification',
        id: patient.userId,
        patientId: patient.userId,
        subjectUserId: patient.userId,
      },
    }).decision;
  }

  async list(patient: PatientPrincipal): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const decision = this.decide(patient, 'view');
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'notification.view',
          resourceType: 'notification',
          resourceId: null,
          patientId: patient.userId,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
        const { rows } = await client.query(
          `SELECT n.id, n.kind, n.treatment_id, n.ref, n.body,
                  n.created_at::text AS created_at, n.read_at::text AS read_at,
                  t.name AS treatment_name
             FROM clinical.notification n
             LEFT JOIN clinical.treatment t ON t.id = n.treatment_id
            WHERE n.recipient_id = $1 AND n.recipient_realm = 'patient'
            ORDER BY n.created_at DESC
            LIMIT 50`,
          [patient.userId],
        );
        const unread = (rows as { read_at: string | null }[]).filter(
          (row) => row.read_at === null,
        ).length;
        return { items: rows, unread };
      },
    );
  }

  async markAllRead(patient: PatientPrincipal): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        if (this.decide(patient, 'mark_read') !== 'allow') {
          throw new ForbiddenException({ status: 'forbidden' });
        }
        const { rowCount } = await client.query(
          `UPDATE clinical.notification SET read_at = now()
            WHERE recipient_id = $1 AND recipient_realm = 'patient' AND read_at IS NULL`,
          [patient.userId],
        );
        return { marked: rowCount ?? 0 };
      },
    );
  }

  private decideSettings(patient: PatientPrincipal, action: 'view' | 'update'): 'allow' | 'deny' {
    return authorize({
      principal: { userId: patient.userId, role: 'patient' },
      action,
      resource: {
        type: 'own_settings',
        id: patient.userId,
        subjectUserId: patient.userId,
      },
    }).decision;
  }

  async emailPrefs(patient: PatientPrincipal): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        if (this.decideSettings(patient, 'view') !== 'allow') {
          throw new ForbiddenException({ status: 'forbidden' });
        }
        const { rows } = await client.query<{ email_prefs: Record<string, unknown> }>(
          `SELECT email_prefs FROM identity.patient_account WHERE id = $1`,
          [patient.userId],
        );
        return { kinds: EMAIL_PREF_KINDS, emailPrefs: rows[0]?.email_prefs ?? {} };
      },
    );
  }

  async updateEmailPrefs(patient: PatientPrincipal, prefs: unknown): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        if (
          typeof prefs !== 'object' ||
          prefs === null ||
          Array.isArray(prefs) ||
          Object.entries(prefs).some(
            ([key, value]) =>
              !EMAIL_PREF_KINDS.includes(key as (typeof EMAIL_PREF_KINDS)[number]) ||
              typeof value !== 'boolean',
          )
        ) {
          throw new BadRequestException({ status: 'invalid_prefs' });
        }
        const decision = this.decideSettings(patient, 'update');
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'own_settings.update',
          resourceType: 'own_settings',
          resourceId: patient.userId,
          patientId: patient.userId,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
        // store only the switched-off keys - absent stays the default (on)
        const off = Object.fromEntries(
          Object.entries(prefs).filter(([, value]) => value === false),
        );
        await client.query(`UPDATE identity.patient_account SET email_prefs = $2 WHERE id = $1`, [
          patient.userId,
          JSON.stringify(off),
        ]);
        await writeChangeEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'own_settings.update',
          resourceType: 'own_settings',
          resourceId: patient.userId,
          patientId: patient.userId,
          detail: { keys: Object.keys(prefs) },
        });
        return { emailPrefs: off };
      },
    );
  }
}
