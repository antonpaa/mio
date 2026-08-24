import pg from 'pg';
import { newLinkToken, hashLinkToken, INVITE_TTL_DAYS } from '../modules/identity/domain/tokens.js';

/**
 * Break-glass bootstrap (decided 2026-08-24): the very first user has to
 * come from OUTSIDE the system - there is no signed-in administrator to
 * invite anyone. This is the one sanctioned out-of-band write path: it
 * runs with the operator's OWNER credentials, creates (or re-invites)
 * an administrator account, and prints the welcome link instead of
 * mailing it. Everything it does lands in the audit log as a system
 * change event marked bootstrap, because a break-glass act that left no
 * trace would be indistinguishable from an attack.
 *
 *   DATABASE_URL=postgres://owner@host/db \
 *     node --import @swc-node/register/esm-register src/cli/bootstrap-admin.ts \
 *     admin@example.org "Given" "Family" [fi|sv|en] [--base-url https://mio.example]
 */

export interface BootstrapResult {
  accountId: string;
  welcomePath: string;
  reinvited: boolean;
}

export async function bootstrapAdmin(
  connectionString: string,
  input: { email: string; givenName: string; familyName: string; locale?: 'en' | 'fi' | 'sv' },
): Promise<BootstrapResult> {
  if (!input.email.includes('@') || !input.givenName.trim() || !input.familyName.trim()) {
    throw new Error('email, given name and family name are required');
  }
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query<{ id: string; status: string; role: string }>(
      `SELECT id, status, role FROM identity.staff_account WHERE lower(email) = lower($1)`,
      [input.email],
    );
    let accountId: string;
    let reinvited = false;
    if (existing[0]) {
      if (existing[0].status === 'deactivated') {
        throw new Error('account exists and is deactivated - reactivate it in A1 instead');
      }
      if (existing[0].role !== 'administrator') {
        throw new Error('account exists with a non-administrator role - refusing to escalate it');
      }
      accountId = existing[0].id;
      reinvited = true;
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO identity.staff_account (email, given_name, family_name, locale, role, title)
         VALUES ($1, $2, $3, $4, 'administrator', 'Administrator') RETURNING id`,
        [input.email, input.givenName.trim(), input.familyName.trim(), input.locale ?? 'en'],
      );
      accountId = rows[0]!.id;
    }
    await client.query(
      `UPDATE identity.credential_token SET consumed_at = now()
        WHERE realm = 'staff' AND account_id = $1 AND kind = 'invite' AND consumed_at IS NULL`,
      [accountId],
    );
    const token = newLinkToken();
    await client.query(
      `INSERT INTO identity.credential_token
         (realm, account_id, kind, secret_hash, max_attempts, expires_at)
       VALUES ('staff', $1, 'invite', $2, 1, now() + make_interval(days => $3))`,
      [accountId, hashLinkToken(token), INVITE_TTL_DAYS],
    );
    // the trace: a system-actor change event that says exactly what
    // happened and that it happened out of band
    await client.query(
      `INSERT INTO audit.change_event
         (actor_user_id, actor_realm, action, resource_type, resource_id, patient_id, detail)
       VALUES (NULL, 'system', 'staff_account.bootstrap', 'staff_account', $1, NULL,
               $2::jsonb)`,
      [accountId, JSON.stringify({ bootstrap: true, reinvited, email: input.email })],
    );
    await client.query('COMMIT');
    return { accountId, welcomePath: `/welcome/${token}`, reinvited };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.endsWith('bootstrap-admin.ts');
if (invokedDirectly) {
  const connectionString = process.env['DATABASE_URL'];
  const [email, givenName, familyName, maybeLocale] = process.argv.slice(2);
  const baseFlag = process.argv.indexOf('--base-url');
  const baseUrl = baseFlag > -1 ? process.argv[baseFlag + 1] : '';
  if (!connectionString || !email || !givenName || !familyName) {
    console.error(
      'usage: DATABASE_URL=<owner url> bootstrap-admin.ts <email> <given> <family> [locale] [--base-url <url>]',
    );
    process.exit(1);
  }
  const locale =
    maybeLocale === 'fi' || maybeLocale === 'sv' || maybeLocale === 'en' ? maybeLocale : undefined;
  bootstrapAdmin(connectionString, {
    email,
    givenName,
    familyName,
    ...(locale ? { locale } : {}),
  })
    .then((result) => {
      console.log(
        `${result.reinvited ? 're-invited' : 'created'} administrator ${result.accountId}`,
      );
      console.log(`welcome link: ${baseUrl}${result.welcomePath}`);
      console.log('the link is single-use and expires in 7 days; it was NOT emailed');
    })
    .catch((error) => {
      console.error(String(error));
      process.exit(1);
    });
}
