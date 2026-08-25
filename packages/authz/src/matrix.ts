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
  /** Normalised: 'deny' is [], a scalar scope is a one-element array,
   * and a YAML list means the UNION of its scopes (e.g. task.complete's
   * clinician [own, team_lead]). */
  grants: Record<Role, readonly Scope[]>;
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
        grants: Record<string, string | string[]>;
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
      const grants: Partial<Record<Role, readonly Scope[]>> = {};
      for (const [role, raw] of Object.entries(a.grants)) {
        if (!(ROLES as readonly string[]).includes(role)) {
          throw new Error(`Unknown role '${role}' in ${r.id}.${a.id}`);
        }
        const listed = Array.isArray(raw) ? raw : [raw];
        for (const scope of listed) {
          if (!(SCOPES as readonly string[]).includes(scope)) {
            throw new Error(`Unknown scope '${scope}' in ${r.id}.${a.id} for ${role}`);
          }
        }
        if (Array.isArray(raw) && (raw.includes('deny') || new Set(raw).size !== raw.length)) {
          throw new Error(`Invalid scope list in ${r.id}.${a.id} for ${role}`);
        }
        grants[role as Role] = (
          listed[0] === 'deny' ? [] : (listed as Scope[])
        ) as readonly Scope[];
      }
      if (a.audit !== 'always' && a.audit !== 'never') {
        throw new Error(`Invalid audit '${a.audit}' in ${r.id}.${a.id}`);
      }
      return {
        id: a.id,
        audit: a.audit,
        grants: grants as Record<Role, readonly Scope[]>,
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

      if (resource.patientScoped && (action.grants.author?.length ?? 0) > 0) {
        add('author_never_patient_scoped', `${ref} = ${action.grants.author?.join('|')}`);
      }

      if (resource.schema === 'clinical' && (action.grants.administrator?.length ?? 0) > 0) {
        add('administrator_no_clinical', `${ref} = ${action.grants.administrator?.join('|')}`);
      }

      const patient = action.grants.patient;
      if (patient !== undefined && patient.some((scope) => scope !== 'self')) {
        add('patient_self_only', `${ref} = ${patient.join('|')}`);
      }

      if (resource.id === 'internal_note' && (patient?.length ?? 0) > 0) {
        add('internal_notes_never_patient', `${ref} = ${patient?.join('|')}`);
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
