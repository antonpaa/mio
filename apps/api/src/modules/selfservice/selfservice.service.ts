import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import { APP_POOL, AUDIT_READER_POOL } from '../../shared/db.module.js';
import type { PatientPrincipal } from '../../shared/patient-session.js';

/**
 * WP-26 self-service: the rest of P8 and the privacy features the design
 * treats as first-class product, not internal tooling.
 *
 * - "Who has viewed my records": read through the DEDICATED audit-reader
 *   carrier role - the app role stays INSERT-only on audit.*. Includes
 *   worklist disclosures (patient id inside context.patientIds), because
 *   a list that showed only direct reads would under-promise what the
 *   log actually knows. Reading one's own history is itself unaudited
 *   (matrix: audit never) to avoid recursion.
 * - GDPR self-export: assembled UNDER THE PATIENT'S OWN RLS CONTEXT, so
 *   what the export can contain is exactly what the patient can read -
 *   internal notes are excluded by construction, not by a filter.
 */

const LOCALES = ['en', 'fi', 'sv'];

interface AddressInput {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

@Injectable()
export class SelfServiceService {
  constructor(
    @Inject(APP_POOL) private readonly pool: pg.Pool,
    @Inject(AUDIT_READER_POOL) private readonly auditReader: pg.Pool,
  ) {}

  private decide(
    patient: PatientPrincipal,
    resource: 'own_settings' | 'audit_log' | 'own_data_export',
    action: string,
  ): 'allow' | 'deny' {
    return authorize({
      principal: { userId: patient.userId, role: 'patient' },
      action,
      resource: { type: resource, id: patient.userId, subjectUserId: patient.userId },
    }).decision;
  }

  async profile(patient: PatientPrincipal): Promise<object> {
    if (this.decide(patient, 'own_settings', 'view') !== 'allow') {
      throw new ForbiddenException({ status: 'forbidden' });
    }
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query(
          `SELECT email, given_name, family_name, locale, phone, address,
                  date_of_birth::text AS date_of_birth
             FROM identity.patient_account WHERE id = $1`,
          [patient.userId],
        );
        return rows[0] as object;
      },
    );
  }

  async updateProfile(
    patient: PatientPrincipal,
    input: { phone?: unknown; address?: unknown; locale?: unknown },
  ): Promise<object> {
    const phone = input.phone;
    const locale = input.locale;
    const address = input.address as AddressInput | undefined;
    if (
      (phone !== undefined && (typeof phone !== 'string' || phone.length > 40)) ||
      (locale !== undefined && !LOCALES.includes(locale as string)) ||
      (address !== undefined &&
        (typeof address !== 'object' ||
          address === null ||
          Object.entries(address).some(
            ([key, value]) =>
              !['street', 'postalCode', 'city', 'country'].includes(key) ||
              typeof value !== 'string' ||
              value.length > 120,
          )))
    ) {
      throw new BadRequestException({ status: 'invalid_profile' });
    }
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const decision = this.decide(patient, 'own_settings', 'update');
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
        await client.query(
          `UPDATE identity.patient_account
              SET phone = COALESCE($2, phone),
                  address = COALESCE($3, address),
                  locale = COALESCE($4, locale)
            WHERE id = $1`,
          [
            patient.userId,
            phone ?? null,
            address !== undefined ? JSON.stringify(address) : null,
            locale ?? null,
          ],
        );
        await writeChangeEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'own_settings.update',
          resourceType: 'own_settings',
          resourceId: patient.userId,
          patientId: patient.userId,
          detail: {
            keys: Object.entries({ phone, address, locale })
              .filter(([, value]) => value !== undefined)
              .map(([key]) => key),
          },
        });
        return { updated: true };
      },
    );
  }

  /** P8 privacy: staff disclosures of this patient's records, newest
   * first - direct reads AND worklist rows that carried the patient. */
  async accessHistory(patient: PatientPrincipal): Promise<object> {
    if (this.decide(patient, 'audit_log', 'view_own_access_history') !== 'allow') {
      throw new ForbiddenException({ status: 'forbidden' });
    }
    const { rows } = await this.auditReader.query(
      `SELECT actor_user_id, action, resource_type, occurred_at::text AS occurred_at
         FROM audit.access_event
        WHERE actor_realm = 'staff' AND decision = 'allow'
          AND (patient_id = $1
               OR (patient_id IS NULL AND context -> 'patientIds' ? $2))
        ORDER BY occurred_at DESC
        LIMIT 200`,
      [patient.userId, patient.userId],
    );
    const actorIds = [
      ...new Set(
        (rows as { actor_user_id: string | null }[])
          .map((row) => row.actor_user_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    const names = new Map<string, { given_name: string; family_name: string; title: string }>();
    if (actorIds.length > 0) {
      const { rows: staff } = await this.pool.query(
        `SELECT id, given_name, family_name, title FROM identity.staff_account
          WHERE id = ANY($1::uuid[])`,
        [actorIds],
      );
      for (const row of staff as {
        id: string;
        given_name: string;
        family_name: string;
        title: string;
      }[]) {
        names.set(row.id, row);
      }
    }
    return {
      events: (rows as Record<string, unknown>[]).map((row) => {
        const actor = names.get(row['actor_user_id'] as string);
        return {
          action: row['action'],
          resource_type: row['resource_type'],
          occurred_at: row['occurred_at'],
          actor_given: actor?.given_name ?? null,
          actor_family: actor?.family_name ?? null,
          actor_title: actor?.title ?? null,
        };
      }),
    };
  }

  /** GDPR access + portability, v1: one JSON document, assembled under
   * the patient's own RLS context. Both matrix actions audited. */
  async export(patient: PatientPrincipal): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        for (const action of ['request', 'download'] as const) {
          const decision = this.decide(patient, 'own_data_export', action);
          await writeAccessEvent(client, {
            actorUserId: patient.userId,
            actorRealm: 'patient',
            action: `own_data_export.${action}`,
            resourceType: 'own_data_export',
            resourceId: patient.userId,
            patientId: patient.userId,
            decision,
          });
          if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
        }
        const one = async (sql: string): Promise<unknown[]> =>
          (await client.query(sql, [patient.userId])).rows;
        const account = (
          await client.query(
            `SELECT email, given_name, family_name, locale, phone, address,
                    date_of_birth::text AS date_of_birth, created_at::text AS created_at
               FROM identity.patient_account WHERE id = $1`,
            [patient.userId],
          )
        ).rows[0];
        const treatments = await one(
          `SELECT id, name, detail, state, started_at::text AS started_at
             FROM clinical.treatment WHERE patient_id = $1 AND state <> 'draft' ORDER BY created_at`,
        );
        const responses = await one(
          `SELECT r.id, r.treatment_id, r.locale, r.status, r.answers,
                  r.submitted_at::text AS submitted_at, s.name AS survey_name
             FROM clinical.survey_response r
             JOIN clinical.survey_version v ON v.id = r.survey_version_id
             JOIN clinical.survey s ON s.id = v.survey_id
            WHERE r.patient_id = $1 ORDER BY r.started_at`,
        );
        // RLS excludes internal notes by construction - there is no
        // patient arm on that table to leak through
        const messages = await one(
          `SELECT m.id, th.treatment_id, m.author_realm, m.body,
                  m.created_at::text AS created_at
             FROM clinical.message m JOIN clinical.message_thread th ON th.id = m.thread_id
            WHERE m.patient_id = $1 ORDER BY m.created_at`,
        );
        const values = await one(
          `SELECT e.id, s.name AS series, s.unit, e.value, e.measured_at::text AS measured_at,
                  e.on_behalf_of_patient
             FROM clinical.value_entry e JOIN clinical.value_series s ON s.id = e.series_id
            WHERE e.patient_id = $1 ORDER BY e.measured_at`,
        );
        const symptoms = await one(
          `SELECT o.id, y.code, o.severity, o.detail, o.source,
                  o.observed_at::text AS observed_at
             FROM clinical.symptom_observation o JOIN clinical.symptom y ON y.id = o.symptom_id
            WHERE o.patient_id = $1 ORDER BY o.observed_at`,
        );
        const notifications = await one(
          `SELECT id, kind, body, created_at::text AS created_at, read_at::text AS read_at
             FROM clinical.notification
            WHERE recipient_id = $1 AND recipient_realm = 'patient' ORDER BY created_at`,
        );
        return {
          format: 'mio-export/v1',
          generatedAt: new Date().toISOString(),
          account,
          treatments,
          surveyResponses: responses,
          messages,
          values,
          symptomObservations: symptoms,
          notifications,
        };
      },
    );
  }
}
