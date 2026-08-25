import { describe, expect, it } from 'vitest';
import { realmOf, ROLE_REALM, ROLES } from './index.js';

describe('roles', () => {
  it('matches the capability matrix vocabulary', () => {
    expect(ROLES).toEqual(['patient', 'clinician', 'author', 'administrator', 'auditor']);
  });

  it('puts exactly one role in the patient realm', () => {
    const patientRoles = ROLES.filter((role) => ROLE_REALM[role] === 'patient');
    expect(patientRoles).toEqual(['patient']);
  });

  it('maps a role set to its realm, rejecting empty and mixed-realm sets', () => {
    expect(realmOf(['clinician', 'administrator'])).toBe('staff');
    expect(realmOf(['patient'])).toBe('patient');
    expect(() => realmOf([])).toThrow(/exactly one realm/);
    expect(() => realmOf(['patient', 'clinician'])).toThrow(/exactly one realm/);
  });
});
