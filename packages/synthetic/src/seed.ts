import pg from 'pg';
import { hash } from '@node-rs/argon2';
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
    await pool.query('DELETE FROM clinical.care_relationship');
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

    let relationships = 0;
    for (const [patientId, staffIds] of world.careRelationships) {
      for (const staffId of staffIds) {
        await pool.query(
          `INSERT INTO clinical.care_relationship (patient_id, staff_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [patientId, staffId],
        );
        relationships += 1;
      }
    }
    log(`care relationships: ${relationships}`);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await pool.end();
  }
}
