import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import { realmOf, ROLES, type Realm, type Role } from './roles.js';
import {
  ACTION_GROUPS,
  ACTION_METADATA,
  EMPTY_GROUPS,
  RESOURCE_ATTRS,
} from './capabilities.generated.js';
import { CEDAR_SCHEMA } from './cedar-schema.generated.js';
import { pascalCase } from './cedar.js';

/**
 * The embedded decision point (ADR-0006): Cedar over the generated schema
 * and the hand-written pattern policies. Server-only - import via
 * '@mio/authz/engine', never from browser code.
 *
 * The decision point is the audit point: every patient-scoped decision -
 * allow AND deny - yields an access-event row the caller MUST write in the
 * same transaction as the access it permits (@mio/db writeAccessEvent).
 * authorize() returning the row instead of writing it keeps this package
 * free of database concerns while making the obligation impossible to miss.
 */

const POLICIES = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'policies.cedar'),
  'utf8',
);

export interface ResourceSlice {
  /** Matrix resource id, e.g. 'treatment'. */
  type: string;
  /** Stable identifier of the concrete resource, for the audit record. */
  id: string;
  /** The patient this resource concerns - drives the audit record. */
  patientId?: string;
  /** User who is the subject of the resource (scope: self). */
  subjectUserId?: string;
  /** User the resource is assigned to / created by (scope: own). */
  ownerUserId?: string;
  /** Users holding an active care relationship (scope: care_relationship). */
  careTeamUserIds?: readonly string[];
  /** The treatment team (scope: team_member). */
  teamUserIds?: readonly string[];
  /** The treatment leads (scope: team_lead). */
  leadUserIds?: readonly string[];
}

export interface AuthorizeInput {
  /** All roles the account holds - the decision is their UNION (a permit
   * under any held role permits). Realms never mix in one set. */
  principal: { userId: string; roles: readonly Role[] };
  /** Matrix action id, e.g. 'view' - combined with resource.type. */
  action: string;
  resource: ResourceSlice;
}

export interface AccessEventRow {
  actorUserId: string;
  actorRealm: Realm;
  action: string;
  resourceType: string;
  resourceId: string;
  patientId: string | null;
  decision: 'allow' | 'deny';
}

export interface AuthorizeResult {
  decision: 'allow' | 'deny';
  /** 'always' actions must write accessEvent in the same transaction. */
  audit: 'always' | 'never';
  accessEvent: AccessEventRow;
}

function userUid(id: string): { __entity: { type: string; id: string } } {
  return { __entity: { type: 'Mio::User', id } };
}

export function authorize(input: AuthorizeInput): AuthorizeResult {
  const actionId = `${input.resource.type}.${input.action}`;
  const metadata = ACTION_METADATA[actionId];
  if (!metadata) {
    // Unknown action: fail closed, and loudly - this is a programming error,
    // not an authorization decision.
    throw new Error(`Unknown action '${actionId}' - not in the capability matrix`);
  }

  const resourceType = `Mio::${pascalCase(input.resource.type)}`;
  // Only attributes the generated schema declares for this type may appear
  // in the slice; a caller passing a broader slice (they will) is fine.
  const declared = new Set(RESOURCE_ATTRS[input.resource.type] ?? []);
  const attrs: Record<string, unknown> = {};
  if (declared.has('subjectUser') && input.resource.subjectUserId !== undefined) {
    attrs['subjectUser'] = userUid(input.resource.subjectUserId);
  }
  if (declared.has('ownerUser') && input.resource.ownerUserId !== undefined) {
    attrs['ownerUser'] = userUid(input.resource.ownerUserId);
  }
  if (declared.has('careTeam') && input.resource.careTeamUserIds) {
    attrs['careTeam'] = input.resource.careTeamUserIds.map(userUid);
  }
  if (declared.has('team') && input.resource.teamUserIds) {
    attrs['team'] = input.resource.teamUserIds.map(userUid);
  }
  if (declared.has('leads') && input.resource.leadUserIds) {
    attrs['leads'] = input.resource.leadUserIds.map(userUid);
  }

  const allUserIds = new Set<string>([
    input.principal.userId,
    ...(input.resource.subjectUserId ? [input.resource.subjectUserId] : []),
    ...(input.resource.ownerUserId ? [input.resource.ownerUserId] : []),
    ...(input.resource.careTeamUserIds ?? []),
    ...(input.resource.teamUserIds ?? []),
    ...(input.resource.leadUserIds ?? []),
  ]);

  const groups = ACTION_GROUPS[actionId] ?? [];
  const roleParents = input.principal.roles.map((role) => ({ type: 'Mio::Role', id: role }));
  const entities = [
    ...input.principal.roles.map((role) => ({
      uid: { type: 'Mio::Role', id: role },
      attrs: {},
      parents: [],
    })),
    ...[...allUserIds].map((id) => ({
      uid: { type: 'Mio::User', id },
      attrs: {},
      parents: id === input.principal.userId ? roleParents : [],
    })),
    { uid: { type: resourceType, id: input.resource.id }, attrs, parents: [] },
    // Action-group membership as entity parents: with these in the slice
    // the hot path needs no schema, and skipping the schema is what makes
    // isAuthorized cheap - cedar-wasm is stateless and would otherwise
    // re-parse the full schema on every single call. Policies and schema
    // still validate together at startup/test time via validatePolicies().
    ...groups.map((group) => ({ uid: { type: 'Mio::Action', id: group }, attrs: {}, parents: [] })),
    {
      uid: { type: 'Mio::Action', id: actionId },
      attrs: {},
      parents: groups.map((group) => ({ type: 'Mio::Action', id: group })),
    },
  ];

  const answer = cedar.isAuthorized({
    principal: { type: 'Mio::User', id: input.principal.userId },
    action: { type: 'Mio::Action', id: actionId },
    resource: { type: resourceType, id: input.resource.id },
    context: {},
    policies: { staticPolicies: POLICIES },
    entities: entities as never,
  });

  if (answer.type !== 'success') {
    throw new Error(
      `Cedar evaluation failed for ${actionId}: ${answer.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const decision = answer.response.decision;
  return {
    decision,
    audit: metadata.audit,
    accessEvent: {
      actorUserId: input.principal.userId,
      actorRealm: realmOf(input.principal.roles),
      action: actionId,
      resourceType: input.resource.type,
      resourceId: input.resource.id,
      patientId: input.resource.patientId ?? null,
      decision,
    },
  };
}

/**
 * Validate the hand-written policies against the generated schema.
 *
 * The policy file carries one pattern policy per (role, scope) in a fixed
 * order (ROLES x non-deny SCOPES; see policies.cedar) - Cedar names them
 * policy0..policy23 positionally. A pattern whose action group has no
 * members in the matrix can never apply; strict validation rightly flags
 * it, and exactly those findings are excused via EMPTY_GROUPS. Anything
 * else is a real error.
 */
const POLICY_ORDER: readonly string[] = ROLES.flatMap((role) =>
  (['self', 'own', 'care_relationship', 'team_member', 'team_lead', 'any'] as const).map(
    (scope) => `grp:${role}:${scope}`,
  ),
);

export function validatePolicies(): string[] {
  const answer = cedar.validate({
    schema: CEDAR_SCHEMA,
    policies: { staticPolicies: POLICIES },
  });
  if (answer.type !== 'success') {
    return answer.errors.map((e) => e.message);
  }
  const emptyGroups = new Set(EMPTY_GROUPS);
  return answer.validationErrors
    .filter((e) => {
      const index = Number(/^policy(\d+)$/.exec(e.policyId)?.[1] ?? NaN);
      const group = POLICY_ORDER[index];
      const impossible = e.error.message.includes('unable to find an applicable action');
      return !(impossible && group !== undefined && emptyGroups.has(group));
    })
    .map((e) => `${e.policyId}: ${e.error.message}`);
}
