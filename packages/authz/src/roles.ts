/**
 * Role and realm vocabulary - verbatim from docs/authz/capability-matrix.yaml
 * (the matrix loader asserts the two never drift).
 */

export const ROLES = ['patient', 'treatment_member', 'treatment_lead', 'administrator'] as const;

export type Role = (typeof ROLES)[number];

export type Realm = 'patient' | 'staff';

export const ROLE_REALM: Readonly<Record<Role, Realm>> = {
  patient: 'patient',
  treatment_member: 'staff',
  treatment_lead: 'staff',
  administrator: 'staff',
};
