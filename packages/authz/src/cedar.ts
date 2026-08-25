import { ROLES, type Role } from './roles.js';
import { SCOPES, type CapabilityMatrix, type Scope } from './matrix.js';

/**
 * Cedar model generation (ADR-0006).
 *
 * Factoring: the SEMANTICS of each scope (what "care_relationship" means as
 * a condition over entities) are hand-written, reviewed policies in
 * policies.cedar - stable as the product grows. WHICH actions fall under
 * which (role, scope) pair comes from the capability matrix and is emitted
 * here as action-group membership in the generated schema. A matrix change
 * is a data diff; the policy file only changes when a new KIND of rule
 * enters the model.
 */

export function pascalCase(id: string): string {
  return id
    .split('_')
    .map((part) => (part[0] ?? '').toUpperCase() + part.slice(1))
    .join('');
}

export function actionId(resourceId: string, action: string): string {
  return `${resourceId}.${action}`;
}

export function groupId(role: Role, scope: Exclude<Scope, 'deny'>): string {
  return `grp:${role}:${scope}`;
}

/** Which slice attribute each relational scope reads. */
const SCOPE_ATTRS: Record<Exclude<Scope, 'deny' | 'any'>, string> = {
  self: 'subjectUser',
  own: 'ownerUser',
  care_relationship: 'careTeam',
  team_member: 'team',
  team_lead: 'leads',
};

export function attrsForResource(
  matrix: CapabilityMatrix,
  resourceId: string,
): { name: string; type: string }[] {
  const resource = matrix.resources.find((r) => r.id === resourceId);
  if (!resource) throw new Error(`Unknown resource ${resourceId}`);
  const needed = new Set<string>();
  for (const action of resource.actions) {
    for (const scopes of Object.values(action.grants)) {
      for (const scope of scopes) {
        if (scope !== 'deny' && scope !== 'any') {
          needed.add(SCOPE_ATTRS[scope]);
        }
      }
    }
  }
  return [...needed].sort().map((name) => ({
    name,
    type: name === 'subjectUser' || name === 'ownerUser' ? 'User' : 'Set<User>',
  }));
}

/**
 * The generated Cedar schema: entity types for every matrix resource (with
 * exactly the attributes its scopes need), the four role entities, every
 * action with its appliesTo, and the role:scope action groups. All 24
 * possible groups are declared even when empty, so the hand-written policy
 * file can reference the full set without chasing the matrix.
 */
export function generateSchema(matrix: CapabilityMatrix): string {
  const lines: string[] = [];
  lines.push('// GENERATED from docs/authz/capability-matrix.yaml - do not edit.');
  lines.push('namespace Mio {');
  lines.push('  entity Role;');
  lines.push('  entity User in [Role];');
  lines.push('');

  for (const resource of matrix.resources) {
    const attrs = attrsForResource(matrix, resource.id);
    if (attrs.length === 0) {
      lines.push(`  entity ${pascalCase(resource.id)};`);
    } else {
      lines.push(`  entity ${pascalCase(resource.id)} {`);
      for (const attr of attrs) {
        lines.push(`    ${attr.name}?: ${attr.type},`);
      }
      lines.push('  };');
    }
  }
  lines.push('');

  for (const role of ROLES) {
    for (const scope of SCOPES) {
      if (scope === 'deny') continue;
      lines.push(`  action "${groupId(role, scope)}";`);
    }
  }
  lines.push('');

  for (const resource of matrix.resources) {
    for (const action of resource.actions) {
      const groups = ROLES.flatMap((role) =>
        action.grants[role]
          .filter((scope) => scope !== 'deny')
          .map((scope) => `Mio::Action::"${groupId(role, scope)}"`),
      );
      const memberOf = groups.length > 0 ? ` in [${groups.join(', ')}]` : '';
      lines.push(
        `  action "${actionId(resource.id, action.id)}"${memberOf} appliesTo {`,
        `    principal: [User],`,
        `    resource: [${pascalCase(resource.id)}],`,
        `    context: {}`,
        `  };`,
      );
    }
  }

  lines.push('}');
  return lines.join('\n') + '\n';
}
