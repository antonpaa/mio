/**
 * Role and realm vocabulary - verbatim from docs/authz/capability-matrix.yaml
 * (the matrix loader asserts the two never drift).
 *
 * Since the 2026-08-26 restructure a staff ACCOUNT may hold several roles
 * (the grants union); 'auditor' is exclusive by rule. Being the lead of a
 * treatment is NOT a role - it is a position on that treatment's care team,
 * enforced by the team_lead scope slices.
 */

export const ROLES = ['patient', 'clinician', 'author', 'administrator', 'auditor'] as const;

export type Role = (typeof ROLES)[number];

export type Realm = 'patient' | 'staff';

export const ROLE_REALM: Readonly<Record<Role, Realm>> = {
  patient: 'patient',
  clinician: 'staff',
  author: 'staff',
  administrator: 'staff',
  auditor: 'staff',
};

/** The realm a role SET lives in; mixing realms is a programming error. */
export function realmOf(roles: readonly Role[]): Realm {
  const realms = new Set(roles.map((role) => ROLE_REALM[role]));
  if (roles.length === 0 || realms.size !== 1) {
    throw new Error(`Role set [${roles.join(', ')}] does not map to exactly one realm`);
  }
  return [...realms][0]!;
}
