import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { PROGRAM_TEMPLATES } from './pools.js';
import { syntheticId } from './random.js';
import type { SyntheticWorld } from './world.js';

/**
 * Seed a generated world into a real database (owner connection). Grows a
 * section whenever a new entity's tables land - identity accounts and the
 * care graph today (WP-10); treatments and beyond as their WPs arrive.
 * Never runs against production by construction: it refuses when the
 * database has any non-.example account.
 */

export const DEMO_PASSWORD = 'demo-password-mio-42';

export async function seedWorld(
  connectionString: string,
  world: SyntheticWorld,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 4 });
  try {
    const { rows: nonSynthetic } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT email FROM identity.patient_account WHERE email NOT LIKE '%.example'
         UNION ALL
         SELECT email FROM identity.staff_account WHERE email NOT LIKE '%.example'
       ) reals`,
    );
    if (Number(nonSynthetic[0]?.n ?? '0') > 0) {
      throw new Error('refusing to seed: database contains non-synthetic accounts (E8)');
    }

    const passwordHash = await hash(DEMO_PASSWORD, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    await pool.query('BEGIN');
    await pool.query('DELETE FROM clinical.activity');
    await pool.query('DELETE FROM clinical.schedule');
    await pool.query('DELETE FROM clinical.care_relationship');
    await pool.query('DELETE FROM clinical.treatment_care_team');
    await pool.query('DELETE FROM clinical.treatment');
    await pool.query('DELETE FROM clinical.treatment_template_version');
    await pool.query('DELETE FROM clinical.treatment_template');
    await pool.query('DELETE FROM identity.team_membership');
    await pool.query('DELETE FROM identity.team');
    await pool.query('DELETE FROM identity.credential_token');
    await pool.query('DELETE FROM identity.terms_acceptance');
    await pool.query('DELETE FROM identity.patient_session');
    await pool.query('DELETE FROM identity.staff_session');
    await pool.query('DELETE FROM identity.patient_account');
    await pool.query('DELETE FROM identity.staff_account');

    for (const staff of world.staff) {
      await pool.query(
        `INSERT INTO identity.staff_account
           (id, email, given_name, family_name, locale, role, title, status, password_hash, password_set_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, now())`,
        [
          staff.id,
          staff.email,
          staff.givenName,
          staff.familyName,
          staff.locale,
          staff.role,
          staff.title,
          passwordHash,
        ],
      );
    }
    log(`staff: ${world.staff.length}`);

    for (const patient of world.patients) {
      await pool.query(
        `INSERT INTO identity.patient_account
           (id, email, given_name, family_name, locale, date_of_birth, phone, address, status, password_hash, password_set_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, now())`,
        [
          patient.id,
          patient.email,
          patient.givenName,
          patient.familyName,
          patient.locale,
          patient.dateOfBirth,
          patient.phone,
          JSON.stringify(patient.address),
          passwordHash,
        ],
      );
    }
    log(`patients: ${world.patients.length}`);

    for (const team of world.teams) {
      await pool.query(`INSERT INTO identity.team (id, name) VALUES ($1, $2)`, [
        team.id,
        team.name,
      ]);
      for (const staffId of team.memberIds) {
        await pool.query(
          `INSERT INTO identity.team_membership (team_id, staff_id) VALUES ($1, $2)`,
          [team.id, staffId],
        );
      }
    }
    log(`teams: ${world.teams.length}`);

    // Templates from the designed catalog: one published v1 each; the first
    // template also carries a draft v2 so the catalog shows the state.
    const versionByKey = new Map<string, string>();
    const someLead = world.staff.find((s) => s.role === 'treatment_lead') ?? world.staff[0];
    for (const [index, template] of PROGRAM_TEMPLATES.entries()) {
      const templateId = syntheticId('tmpl', index);
      const versionId = syntheticId('tmplv', index);
      await pool.query(
        `INSERT INTO clinical.treatment_template (id, name, detail, created_by)
         VALUES ($1, $2, $3, $4)`,
        [templateId, template.name, template.detail, someLead!.id],
      );
      await pool.query(
        `INSERT INTO clinical.treatment_template_version (id, template_id, version, state, created_by, published_at)
         VALUES ($1, $2, 1, 'published', $3, now())`,
        [versionId, templateId, someLead!.id],
      );
      if (index === 0) {
        await pool.query(
          `INSERT INTO clinical.treatment_template_version (id, template_id, version, state, created_by)
           VALUES ($1, $2, 2, 'draft', $3)`,
          [syntheticId('tmplv', 100), templateId, someLead!.id],
        );
      }
      versionByKey.set(template.key, versionId);
    }
    log(`templates: ${PROGRAM_TEMPLATES.length}`);

    const teamById = new Map(world.teams.map((team) => [team.id, team]));
    for (const treatment of world.treatments) {
      const team = teamById.get(treatment.teamId);
      const lead = team?.leadIds[0] ?? someLead!.id;
      await pool.query(
        `INSERT INTO clinical.treatment
           (id, patient_id, template_version_id, name, state, created_by, started_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [
          treatment.id,
          treatment.patientId,
          versionByKey.get(treatment.templateKey) ?? null,
          treatment.name,
          treatment.state,
          lead,
          treatment.startedAt,
        ],
      );
      // Leads individually, the staff team attached as a group (PP1).
      for (const leadId of team?.leadIds ?? []) {
        await pool.query(
          `INSERT INTO clinical.treatment_care_team (treatment_id, staff_id, role, added_by)
           VALUES ($1, $2, 'lead', $3)`,
          [treatment.id, leadId, lead],
        );
      }
      await pool.query(
        `INSERT INTO clinical.treatment_care_team (treatment_id, team_id, role, added_by)
         VALUES ($1, $2, 'member', $3)`,
        [treatment.id, treatment.teamId, lead],
      );
      await pool.query(`SELECT app.sync_care_relationships($1)`, [treatment.id]);
    }
    log(`treatments: ${world.treatments.length} (care graph synced per treatment)`);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await pool.end();
  }
}
