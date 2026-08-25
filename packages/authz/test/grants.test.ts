import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLES } from '../src/roles.js';
import { authorize, type ResourceSlice } from '../src/engine.js';
import { defaultMatrixPath, loadMatrix, type Scope } from '../src/matrix.js';

/**
 * The exhaustive suite (ADR-0006): every grant in the capability matrix,
 * asserted against the real Cedar engine with the real generated schema and
 * the real hand-written policies. A grant is a scope SET (usually one, [] is
 * deny, several is a union). For each scope in a grant: the satisfying slice
 * allows and the near-miss slice denies - unless a sibling scope in the same
 * union legitimately covers that near-miss. For a deny grant: even a
 * MAXIMALLY favorable slice - principal as subject, owner, care team, team
 * and lead all at once - is denied, because no policy path may exist at all.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const matrix = loadMatrix(defaultMatrixPath(REPO_ROOT));

const PRINCIPAL = 'user-principal';
const OTHER = 'user-other';

function slice(resourceType: string, overrides: Partial<ResourceSlice>): ResourceSlice {
  return { type: resourceType, id: 'res-1', patientId: 'patient-1', ...overrides };
}

/** The slice that SHOULD satisfy the scope, and near-misses that must not. */
function scenarios(
  resourceType: string,
  scope: Exclude<Scope, 'deny'>,
): { positive: ResourceSlice; negatives: ResourceSlice[] } {
  switch (scope) {
    case 'any':
      return { positive: slice(resourceType, {}), negatives: [] };
    case 'self':
      return {
        positive: slice(resourceType, { subjectUserId: PRINCIPAL }),
        negatives: [slice(resourceType, { subjectUserId: OTHER })],
      };
    case 'own':
      return {
        positive: slice(resourceType, { ownerUserId: PRINCIPAL }),
        negatives: [slice(resourceType, { ownerUserId: OTHER })],
      };
    case 'care_relationship':
      return {
        positive: slice(resourceType, { careTeamUserIds: [OTHER, PRINCIPAL] }),
        negatives: [
          slice(resourceType, { careTeamUserIds: [OTHER] }),
          slice(resourceType, { careTeamUserIds: [] }),
        ],
      };
    case 'team_member':
      return {
        positive: slice(resourceType, { teamUserIds: [OTHER, PRINCIPAL] }),
        negatives: [slice(resourceType, { teamUserIds: [OTHER] })],
      };
    case 'team_lead':
      return {
        positive: slice(resourceType, { leadUserIds: [PRINCIPAL], teamUserIds: [PRINCIPAL] }),
        // On the team but NOT a lead is the near-miss that matters here.
        negatives: [slice(resourceType, { leadUserIds: [OTHER], teamUserIds: [PRINCIPAL, OTHER] })],
      };
  }
}

/** Whether a slice satisfies a scope FOR THE PRINCIPAL - used to skip a
 * near-miss that a sibling scope in the same union legitimately covers. */
function sliceSatisfies(s: ResourceSlice, scope: Exclude<Scope, 'deny'>): boolean {
  switch (scope) {
    case 'any':
      return true;
    case 'self':
      return s.subjectUserId === PRINCIPAL;
    case 'own':
      return s.ownerUserId === PRINCIPAL;
    case 'care_relationship':
      return (s.careTeamUserIds ?? []).includes(PRINCIPAL);
    case 'team_member':
      return (s.teamUserIds ?? []).includes(PRINCIPAL);
    case 'team_lead':
      return (s.leadUserIds ?? []).includes(PRINCIPAL);
  }
}

/** Every relation satisfied at once - the strongest test of a deny grant. */
function maximallyFavorable(resourceType: string): ResourceSlice {
  return slice(resourceType, {
    subjectUserId: PRINCIPAL,
    ownerUserId: PRINCIPAL,
    careTeamUserIds: [PRINCIPAL],
    teamUserIds: [PRINCIPAL],
    leadUserIds: [PRINCIPAL],
  });
}

let grantsChecked = 0;

for (const resource of matrix.resources) {
  describe(resource.id, () => {
    for (const action of resource.actions) {
      it(`${action.id}: every role behaves per the matrix`, () => {
        const failures: string[] = [];
        for (const role of ROLES) {
          grantsChecked += 1;
          const scopes = action.grants[role] as readonly Exclude<Scope, 'deny'>[];
          const principal = { userId: PRINCIPAL, roles: [role] };
          const call = (resourceSlice: ResourceSlice): 'allow' | 'deny' =>
            authorize({ principal, action: action.id, resource: resourceSlice }).decision;

          if (scopes.length === 0) {
            if (call(maximallyFavorable(resource.id)) !== 'deny') {
              failures.push(`${role}: deny grant allowed despite being a deny`);
            }
            continue;
          }
          for (const scope of scopes) {
            const { positive, negatives } = scenarios(resource.id, scope);
            if (call(positive) !== 'allow') {
              failures.push(`${role}: ${scope} positive scenario denied`);
            }
            for (const [index, negative] of negatives.entries()) {
              if (scopes.some((sibling) => sliceSatisfies(negative, sibling))) {
                continue;
              }
              if (call(negative) !== 'deny') {
                failures.push(`${role}: ${scope} near-miss #${index} allowed`);
              }
            }
          }
        }
        expect(failures).toEqual([]);
      });
    }
  });
}

describe('coverage', () => {
  it('walked every grant in the matrix', () => {
    // Every role x every action. If this number surprises you, the matrix
    // changed - which is fine; the suite scales with it automatically.
    expect(grantsChecked).toBe(
      ROLES.length * matrix.resources.reduce((n, r) => n + r.actions.length, 0),
    );
  });
});
