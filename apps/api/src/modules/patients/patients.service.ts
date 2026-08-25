import {
  BadRequestException,
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import { APP_POOL } from '../../shared/db.module.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * Patients: roster and profile - the first real patient-scoped reads, so
 * this module sets the pattern every later clinical read follows
 * (docs/architecture/authorization.md):
 *
 *   scope in SQL -> decide in Cedar -> audit in the SAME transaction ->
 *   only then read.
 *
 * Everything runs inside withUserContext so the RLS backstop sees the
 * caller too.
 */

export interface RosterRow {
  patientId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  locale: string;
}

export interface PatientProfile {
  patientId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  email: string;
  phone: string | null;
  address: Record<string, string> | null;
  locale: string;
  careTeamSize: number;
  deceasedOn: string | null;
}

@Injectable()
export class PatientsService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  /**
   * The roster (C3): SQL-scoped by care relationship; ONE list-level audit
   * event naming the patients disclosed - not one per row
   * (docs/architecture/authorization.md, audit volume).
   */
  async roster(staff: StaffPrincipal): Promise<RosterRow[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query<{
        patient_id: string;
        given_name: string;
        family_name: string;
        date_of_birth: string | null;
        locale: string;
      }>(
        `SELECT p.id AS patient_id, p.given_name, p.family_name,
                p.date_of_birth::text, p.locale
           FROM clinical.care_relationship cr
           JOIN identity.patient_account p ON p.id = cr.patient_id
          WHERE cr.staff_id = $1 AND cr.ended_at IS NULL
          GROUP BY p.id
          ORDER BY p.family_name, p.given_name`,
        [staff.userId],
      );

      // Spot-check the scoping with the decision point: the caller holds a
      // care relationship with every row by construction; a Cedar deny here
      // means scoping and policy disagree - fail loud, never leak. SAMPLED
      // (WP-32): the resource is built identically per row - the decision
      // depends on role and membership, never the id - so any disagreement
      // is systemic and the first rows trip it; evaluating all ~600 rows
      // of a busy lead's roster re-proved the same decision at ~0.5s cost.
      for (const row of rows.slice(0, 25)) {
        const decision = authorize({
          principal: { userId: staff.userId, role: staff.role },
          action: 'view',
          resource: {
            type: 'patient_identity',
            id: row.patient_id,
            patientId: row.patient_id,
            careTeamUserIds: [staff.userId],
          },
        });
        if (decision.decision !== 'allow') {
          throw new ForbiddenException({ status: 'scoping_policy_disagreement' });
        }
      }

      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'patient_identity.view',
        resourceType: 'patient_roster',
        resourceId: null,
        patientId: null,
        decision: 'allow',
        context: { patientIds: rows.map((row) => row.patient_id) },
      });

      return rows.map((row) => ({
        patientId: row.patient_id,
        givenName: row.given_name,
        familyName: row.family_name,
        dateOfBirth: row.date_of_birth,
        locale: row.locale,
      }));
    });
  }

  /**
   * The profile header (C2): Cedar decides, audit lands with the read.
   * The same-transaction rule binds the audit row to the PERMITTED read;
   * a denial performs no read, so its audit row gets its own transaction -
   * throwing inside the context transaction would roll the denial record
   * back with it (the tests caught exactly that).
   */
  async profile(staff: StaffPrincipal, patientId: string): Promise<PatientProfile> {
    const result = await withUserContext(
      this.pool,
      { userId: staff.userId, realm: 'staff' },
      async (client): Promise<PatientProfile | 'denied'> => {
        // Slice building goes through the SECURITY DEFINER helper: RLS shows
        // a clinician only their own relationship rows, but Cedar must judge
        // against the FULL team (and the UI shows its true size).
        const { rows: careRows } = await client.query<{ team: string[] }>(
          `SELECT app.care_team_of($1) AS team`,
          [patientId],
        );
        const careTeam = careRows[0]?.team ?? [];

        const decision = authorize({
          principal: { userId: staff.userId, role: staff.role },
          action: 'view',
          resource: {
            type: 'patient_clinical_profile',
            id: patientId,
            patientId,
            careTeamUserIds: careTeam,
          },
        });

        if (decision.decision !== 'allow') return 'denied';

        await writeAccessEvent(client, {
          actorUserId: decision.accessEvent.actorUserId,
          actorRealm: decision.accessEvent.actorRealm,
          action: decision.accessEvent.action,
          resourceType: decision.accessEvent.resourceType,
          resourceId: decision.accessEvent.resourceId,
          patientId: decision.accessEvent.patientId,
          decision: 'allow',
        });

        const { rows } = await client.query<{
          id: string;
          given_name: string;
          family_name: string;
          date_of_birth: string | null;
          email: string;
          phone: string | null;
          address: Record<string, string> | null;
          locale: string;
          deceased_on: string | null;
        }>(
          `SELECT id, given_name, family_name, date_of_birth::text, email, phone, address, locale,
                  deceased_on::text AS deceased_on
           FROM identity.patient_account WHERE id = $1`,
          [patientId],
        );
        const patient = rows[0];
        if (!patient) throw new NotFoundException({ status: 'unknown_patient' });

        return {
          patientId: patient.id,
          givenName: patient.given_name,
          familyName: patient.family_name,
          dateOfBirth: patient.date_of_birth,
          email: patient.email,
          phone: patient.phone,
          address: patient.address,
          locale: patient.locale,
          careTeamSize: careTeam.length,
          deceasedOn: patient.deceased_on,
        };
      },
    );

    if (result === 'denied') {
      // Durable on its own: there is no read for it to be atomic with.
      await withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, (client) =>
        writeAccessEvent(client, {
          actorUserId: staff.userId,
          actorRealm: 'staff',
          action: 'patient_clinical_profile.view',
          resourceType: 'patient_clinical_profile',
          resourceId: patientId,
          patientId,
          decision: 'deny',
        }),
      );
      throw new ForbiddenException({ status: 'forbidden' });
    }
    return result;
  }

  /**
   * PP5 (WP-28): the clinician-prepared export - "who requested it and
   * why" is the point, so the REASON is required and rides the audit
   * record. Content mirrors the patient's own GDPR export: what the
   * patient could download themselves, prepared by a caring hand -
   * internal notes stay out, they are team process, not patient record.
   */
  /** WP-29: a care decision by the lead who knows the patient. Sign-in
   * closes, sessions die, outbound automation checks the flag from here
   * on; the record is retained, respectfully, per the retention policy. */
  async markDeceased(
    staff: StaffPrincipal,
    patientId: string,
    date: string | undefined,
  ): Promise<object> {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? new Date(`${date}T00:00:00Z`) : null;
    if (
      parsed === null ||
      Number.isNaN(parsed.getTime()) ||
      parsed.getTime() > Date.now() ||
      parsed.getUTCFullYear() < 1900
    ) {
      throw new BadRequestException({ status: 'invalid_date' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows: careRows } = await client.query<{ team: string[] }>(
        `SELECT app.care_team_of($1) AS team`,
        [patientId],
      );
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'mark_deceased',
        resource: {
          type: 'patient_account',
          id: patientId,
          patientId,
          careTeamUserIds: careRows[0]?.team ?? [],
        },
      }).decision;
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'patient_account.mark_deceased',
        resourceType: 'patient_account',
        resourceId: patientId,
        patientId,
        decision,
        context: { date },
      });
      if (decision !== 'allow') throw new NotFoundException({ status: 'unknown_patient' });
      const { rowCount } = await client.query(
        `UPDATE identity.patient_account
            SET deceased_on = $2, status = 'deactivated'
          WHERE id = $1 AND deceased_on IS NULL`,
        [patientId, date],
      );
      if (rowCount === 0) throw new BadRequestException({ status: 'already_marked' });
      await client.query(
        `UPDATE identity.patient_session SET revoked_at = now()
          WHERE account_id = $1 AND revoked_at IS NULL`,
        [patientId],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'patient_account.mark_deceased',
        resourceType: 'patient_account',
        resourceId: patientId,
        patientId,
      });
      return { marked: true };
    });
  }

  /**
   * PP5 assisted edits: the care team corrects the contact details a
   * patient gave them at the desk or over the phone. Deliberately the
   * SAME field set the patient can change themselves in P8 - helping
   * someone do what they could do alone. Email is not in it: that is
   * the login identity, and moving it is an A1 credential act, not a
   * contact correction.
   */
  async updateContactDetails(
    staff: StaffPrincipal,
    patientId: string,
    input: { phone?: unknown; address?: unknown; locale?: unknown },
  ): Promise<object> {
    const phone = input.phone;
    const locale = input.locale;
    const address = input.address as Record<string, string> | undefined;
    if (
      (phone !== undefined && (typeof phone !== 'string' || phone.length > 40)) ||
      (locale !== undefined && !['en', 'fi', 'sv'].includes(locale as string)) ||
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
    if (phone === undefined && address === undefined && locale === undefined) {
      throw new BadRequestException({ status: 'nothing_to_update' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows: careRows } = await client.query<{ team: string[] }>(
        `SELECT app.care_team_of($1) AS team`,
        [patientId],
      );
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'update_contact_details',
        resource: {
          type: 'patient_identity',
          id: patientId,
          patientId,
          subjectUserId: patientId,
          careTeamUserIds: careRows[0]?.team ?? [],
        },
      }).decision;
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'patient_identity.update_contact_details',
        resourceType: 'patient_identity',
        resourceId: patientId,
        patientId,
        decision,
      });
      // an outsider learns nothing: the same 404 an unknown id gets
      if (decision !== 'allow') throw new NotFoundException({ status: 'unknown_patient' });
      const { rowCount } = await client.query(
        `UPDATE identity.patient_account
            SET phone = COALESCE($2, phone),
                address = COALESCE($3, address),
                locale = COALESCE($4, locale)
          WHERE id = $1 AND deceased_on IS NULL`,
        [
          patientId,
          phone ?? null,
          address !== undefined ? JSON.stringify(address) : null,
          locale ?? null,
        ],
      );
      if (rowCount === 0) throw new BadRequestException({ status: 'unknown_patient' });
      // WHICH fields moved, never the values: the audit trail is not a
      // second copy of the patient's contact details
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'patient_identity.update_contact_details',
        resourceType: 'patient_identity',
        resourceId: patientId,
        patientId,
        detail: {
          keys: Object.entries({ phone, address, locale })
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
          assisted: true,
        },
      });
      return { updated: true };
    });
  }

  async exportPatient(
    staff: StaffPrincipal,
    patientId: string,
    reason: string | undefined,
  ): Promise<object> {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length === 0 || trimmed.length > 300) {
      throw new BadRequestException({ status: 'reason_required' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows: careRows } = await client.query<{ team: string[] }>(
        `SELECT app.care_team_of($1) AS team`,
        [patientId],
      );
      const careTeam = careRows[0]?.team ?? [];
      for (const action of ['request', 'download'] as const) {
        const decision = authorize({
          principal: { userId: staff.userId, role: staff.role },
          action,
          resource: {
            type: 'patient_data_export',
            id: patientId,
            patientId,
            careTeamUserIds: careTeam,
          },
        }).decision;
        await writeAccessEvent(client, {
          actorUserId: staff.userId,
          actorRealm: 'staff',
          action: `patient_data_export.${action}`,
          resourceType: 'patient_data_export',
          resourceId: patientId,
          patientId,
          decision,
          context: { reason: trimmed },
        });
        if (decision !== 'allow') throw new NotFoundException({ status: 'unknown_patient' });
      }
      const one = async (sql: string): Promise<unknown[]> =>
        (await client.query(sql, [patientId])).rows;
      const account = (
        await client.query(
          `SELECT email, given_name, family_name, locale, date_of_birth::text AS date_of_birth
             FROM identity.patient_account WHERE id = $1`,
          [patientId],
        )
      ).rows[0];
      if (account === undefined) throw new NotFoundException({ status: 'unknown_patient' });
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
      const messages = await one(
        `SELECT m.id, th.treatment_id, m.author_realm, m.body, m.created_at::text AS created_at
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
        `SELECT o.id, y.code, o.severity, o.detail, o.source, o.observed_at::text AS observed_at
           FROM clinical.symptom_observation o JOIN clinical.symptom y ON y.id = o.symptom_id
          WHERE o.patient_id = $1 ORDER BY o.observed_at`,
      );
      return {
        format: 'mio-export/v1',
        preparedBy: staff.userId,
        reason: trimmed,
        generatedAt: new Date().toISOString(),
        account,
        treatments,
        surveyResponses: responses,
        messages,
        values,
        symptomObservations: symptoms,
      };
    });
  }
}
