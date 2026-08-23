import { describe, expect, it } from 'vitest';
import { authorize, validatePolicies } from '../src/engine.js';

describe('the decision engine', () => {
  it('hand-written policies validate against the generated schema', () => {
    expect(validatePolicies()).toEqual([]);
  });

  it('fails closed and loudly on an action outside the matrix', () => {
    expect(() =>
      authorize({
        principal: { userId: 'u1', role: 'treatment_member' },
        action: 'frobnicate',
        resource: { type: 'treatment', id: 't1' },
      }),
    ).toThrow(/not in the capability matrix/);
  });

  it('ignores slice attributes the resource type does not declare', () => {
    // internal_note's scopes only need `team`; a subjectUserId in the slice
    // must be dropped, not rejected - callers pass broad slices.
    const result = authorize({
      principal: { userId: 'u-pat', role: 'patient' },
      action: 'view',
      resource: { type: 'internal_note', id: 'n1', subjectUserId: 'u-pat', teamUserIds: ['u-doc'] },
    });
    expect(result.decision).toBe('deny');
  });

  it('returns the audit obligation and a ready access-event row - denials included', () => {
    const result = authorize({
      principal: { userId: 'u-doc', role: 'treatment_member' },
      action: 'view',
      resource: {
        type: 'patient_clinical_profile',
        id: 'profile-9',
        patientId: 'patient-9',
        careTeamUserIds: ['someone-else'],
      },
    });
    expect(result.decision).toBe('deny');
    expect(result.audit).toBe('always');
    expect(result.accessEvent).toEqual({
      actorUserId: 'u-doc',
      actorRealm: 'staff',
      action: 'patient_clinical_profile.view',
      resourceType: 'patient_clinical_profile',
      resourceId: 'profile-9',
      patientId: 'patient-9',
      decision: 'deny',
    });
  });
});
