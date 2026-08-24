import { describe, expect, it } from 'vitest';
import { ROLE_REALM, ROLES } from './index.js';

describe('roles', () => {
  it('matches the capability matrix vocabulary', () => {
    expect(ROLES).toEqual([
      'patient',
      'treatment_member',
      'treatment_lead',
      'administrator',
      'auditor',
    ]);
  });

  it('puts exactly one role in the patient realm', () => {
    const patientRoles = ROLES.filter((role) => ROLE_REALM[role] === 'patient');
    expect(patientRoles).toEqual(['patient']);
  });
});
