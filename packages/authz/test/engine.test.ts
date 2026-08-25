import { describe, expect, it } from 'vitest';
import { authorize, validatePolicies } from '../src/engine.js';

describe('the decision engine', () => {
  it('hand-written policies validate against the generated schema', () => {
    expect(validatePolicies()).toEqual([]);
  });

  it('fails closed and loudly on an action outside the matrix', () => {
    expect(() =>
      authorize({
        principal: { userId: 'u1', roles: ['clinician'] },
        action: 'frobnicate',
        resource: { type: 'treatment', id: 't1' },
      }),
    ).toThrow(/not in the capability matrix/);
  });

  it('ignores slice attributes the resource type does not declare', () => {
    // internal_note's scopes only need `team`; a subjectUserId in the slice
    // must be dropped, not rejected - callers pass broad slices.
    const result = authorize({
      principal: { userId: 'u-pat', roles: ['patient'] },
      action: 'view',
      resource: { type: 'internal_note', id: 'n1', subjectUserId: 'u-pat', teamUserIds: ['u-doc'] },
    });
    expect(result.decision).toBe('deny');
  });

  it('a multi-role principal gets the UNION of its roles', () => {
    // survey_template.publish: author any, clinician deny, administrator deny.
    const resource = { type: 'survey_template', id: 'tpl-1' } as const;
    const alone = authorize({
      principal: { userId: 'u-adm', roles: ['administrator'] },
      action: 'publish',
      resource,
    });
    expect(alone.decision).toBe('deny');
    const withAuthor = authorize({
      principal: { userId: 'u-adm', roles: ['administrator', 'author'] },
      action: 'publish',
      resource,
    });
    expect(withAuthor.decision).toBe('allow');
  });

  it('returns the audit obligation and a ready access-event row - denials included', () => {
    const result = authorize({
      principal: { userId: 'u-doc', roles: ['clinician'] },
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
