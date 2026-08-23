/**
 * Universal (browser-safe) surface of @mio/authz: the role vocabulary and
 * the generated capability flags. The matrix loader ('@mio/authz/matrix')
 * and the Cedar engine ('@mio/authz/engine') are node-only.
 */

export { ROLE_REALM, ROLES, type Realm, type Role } from './roles.js';
export {
  ACTION_METADATA,
  EMPTY_GROUPS,
  RESOURCE_ATTRS,
  ROLE_CAPABILITIES,
} from './capabilities.generated.js';
