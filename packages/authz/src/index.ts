/**
 * Authorization primitives. The Cedar engine, the generated policy tests and
 * the capability flags arrive with WP-04; the role and realm vocabulary is
 * stable now and comes verbatim from docs/authz/capability-matrix.yaml.
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
