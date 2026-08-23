import pg from 'pg';

/**
 * Role-carrying pools (docs/architecture/data-model.md). Deployments
 * connect as a login user granted exactly one NOLOGIN carrier role;
 * SET ROLE on connect drops the session to that carrier's privileges, so
 * the same mechanics hold locally (one dev superuser) and in production
 * (one login user per deployable).
 */

export type CarrierRole = 'mio_app' | 'mio_admin' | 'mio_worker' | 'mio_audit_reader';

export interface RolePoolOptions {
  connectionString: string;
  role: CarrierRole;
  max?: number;
}

export function createRolePool(options: RolePoolOptions): pg.Pool {
  // The role is applied as a connection STARTUP parameter ("role" is the
  // GUC behind SET ROLE), not in a 'connect' event handler - the event is
  // not awaited before checkout, so a handler would race the first query.
  // The CarrierRole union is the allowlist that makes the interpolation safe.
  return new pg.Pool({
    connectionString: options.connectionString,
    options: `-c role=${options.role}`,
    ...(options.max !== undefined ? { max: options.max } : {}),
  });
}

export interface UserContext {
  userId: string;
  realm: 'patient' | 'staff';
}

/**
 * Run `fn` inside one transaction with the RLS user context applied.
 * SET LOCAL scopes the settings to this transaction only - correct under
 * PgBouncer transaction pooling, and gone the moment the transaction ends.
 * app.current_user_id()/app.current_realm() read these in policies.
 */
export async function withUserContext<T>(
  pool: pg.Pool,
  context: UserContext,
  fn: (client: pg.ClientBase) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config with `true` = SET LOCAL semantics, and it takes parameters.
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      'app.user_id',
      context.userId,
      'app.realm',
      context.realm,
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
