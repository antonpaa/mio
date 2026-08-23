import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { ROLES, type Role } from './roles.js';

/**
 * Loader and validator for docs/authz/capability-matrix.yaml - THE source of
 * truth for authorization (ADR-0006). The generator (generate.ts), the Cedar
 * schema, the UI capability flags and the exhaustive test suite all derive
 * from what this module returns; the invariants below are the ones the
 * matrix declares for itself.
 */

export const SCOPES = [
  'deny',
  'self',
  'own',
  'care_relationship',
  'team_member',
  'team_lead',
  'any',
] as const;

export type Scope = (typeof SCOPES)[number];

export interface MatrixAction {
  id: string;
  audit: 'always' | 'never';
  grants: Record<Role, Scope>;
  notes?: string;
}

export interface MatrixResource {
  id: string;
  schema: 'identity' | 'clinical' | 'audit';
  patientScoped: boolean;
  description?: string;
  actions: MatrixAction[];
}

export interface CapabilityMatrix {
  version: number;
  resources: MatrixResource[];
}

/** Relative strength used ONLY by the lead-superset invariant. */
const STRENGTH: Record<Scope, number> = {
  deny: 0,
  self: 1,
  own: 1,
  care_relationship: 2,
  team_member: 2,
  team_lead: 3,
  any: 4,
};

const READ_ACTIONS = new Set(['view', 'download', 'view_trend']);

export function defaultMatrixPath(repoRoot: string): string {
  return path.join(repoRoot, 'docs', 'authz', 'capability-matrix.yaml');
}

export function loadMatrix(filePath: string): CapabilityMatrix {
  const doc = parse(readFileSync(filePath, 'utf8')) as {
    version: number;
    roles: { id: string; realm: string }[];
    resources: {
      id: string;
      schema: string;
      patient_scoped: boolean;
      description?: string;
      actions: {
        id: string;
        audit: string;
        grants: Record<string, string>;
        notes?: string;
      }[];
    }[];
  };

  const matrixRoles = doc.roles.map((r) => r.id);
  if (JSON.stringify(matrixRoles) !== JSON.stringify([...ROLES])) {
    throw new Error(
      `Matrix roles [${matrixRoles.join(', ')}] do not match @mio/authz ROLES [${ROLES.join(', ')}]`,
    );
  }

  const resources: MatrixResource[] = doc.resources.map((r) => ({
    id: r.id,
    schema: r.schema as MatrixResource['schema'],
    patientScoped: r.patient_scoped,
    ...(r.description !== undefined ? { description: r.description } : {}),
    actions: r.actions.map((a) => {
      const grants: Partial<Record<Role, Scope>> = {};
      for (const [role, scope] of Object.entries(a.grants)) {
        if (!(ROLES as readonly string[]).includes(role)) {
          throw new Error(`Unknown role '${role}' in ${r.id}.${a.id}`);
        }
        if (!(SCOPES as readonly string[]).includes(scope)) {
          throw new Error(`Unknown scope '${scope}' in ${r.id}.${a.id} for ${role}`);
        }
        grants[role as Role] = scope as Scope;
      }
      if (a.audit !== 'always' && a.audit !== 'never') {
        throw new Error(`Invalid audit '${a.audit}' in ${r.id}.${a.id}`);
      }
      return {
        id: a.id,
        audit: a.audit,
        grants: grants as Record<Role, Scope>,
        ...(a.notes !== undefined ? { notes: a.notes } : {}),
      };
    }),
  }));

  return { version: doc.version, resources };
}

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

/**
 * The six invariants the matrix declares (docs/authz/README.md). This is the
 * TypeScript home of what docs/authz/validate_matrix.py checked before the
 * application codebase existed.
 */
export function checkInvariants(matrix: CapabilityMatrix): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const add = (invariant: string, detail: string): void => {
    violations.push({ invariant, detail });
  };

  for (const resource of matrix.resources) {
    for (const action of resource.actions) {
      const ref = `${resource.id}.${action.id}`;

      for (const role of ROLES) {
        if (action.grants[role] === undefined) {
          add('exhaustive', `${ref} :: ${role} has no explicit grant`);
        }
      }

      const member = action.grants.treatment_member;
      const lead = action.grants.treatment_lead;
      if (member !== undefined && lead !== undefined && STRENGTH[lead] < STRENGTH[member]) {
        add('superset_lead_member', `${ref}: member=${member} lead=${lead}`);
      }

      if (resource.schema === 'clinical' && action.grants.administrator !== 'deny') {
        add('administrator_no_clinical', `${ref} = ${action.grants.administrator}`);
      }

      const patient = action.grants.patient;
      if (patient !== undefined && patient !== 'deny' && patient !== 'self') {
        add('patient_self_only', `${ref} = ${patient}`);
      }

      if (resource.id === 'internal_note' && patient !== 'deny') {
        add('internal_notes_never_patient', `${ref} = ${patient}`);
      }

      if (resource.patientScoped && READ_ACTIONS.has(action.id) && action.audit !== 'always') {
        add('patient_scoped_reads_are_audited', ref);
      }
    }
  }

  return violations;
}

export function grantCount(matrix: CapabilityMatrix): number {
  return ROLES.length * matrix.resources.reduce((n, r) => n + r.actions.length, 0);
}
