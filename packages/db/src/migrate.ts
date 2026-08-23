import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Plain-SQL, forward-only migration runner (docs/architecture/data-model.md).
 *
 * Rules it enforces:
 *  - migrations are NNNN_name.sql, applied in ascending order, each in its
 *    own transaction;
 *  - applied migrations are immutable: a checksum mismatch aborts, because a
 *    silently edited migration means the database and the repository no
 *    longer agree on history;
 *  - a cluster-wide advisory lock serializes concurrent runners (two API
 *    instances deploying at once).
 *
 * Migrations always run as the database owner; the foundation migration's
 * ALTER DEFAULT PRIVILEGES binds to that owner, which is what makes grants
 * automatic for tables created by later migrations.
 */

const ADVISORY_LOCK_KEY = 7_413_001; // arbitrary, stable: "mio migrations"

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: MigrationFile[];
  alreadyApplied: number;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export async function loadMigrations(
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  const seen = new Set<number>();
  for (const filename of entries) {
    const match = FILE_PATTERN.exec(filename);
    if (!match) {
      throw new Error(`Migration filename does not match NNNN_name.sql: ${filename}`);
    }
    const version = Number(match[1]);
    if (seen.has(version)) {
      throw new Error(`Duplicate migration version ${version}`);
    }
    seen.add(version);
    const sql = await readFile(path.join(dir, filename), 'utf8');
    files.push({
      version,
      name: match[2] as string,
      filename,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return files;
}

export async function migrate(
  connectionString: string,
  options: { dir?: string; log?: (msg: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => {});
  const migrations = await loadMigrations(options.dir);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version    integer PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows: appliedRows } = await client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM public.schema_migrations ORDER BY version',
    );
    const appliedByVersion = new Map(appliedRows.map((r) => [r.version, r.checksum]));

    for (const migration of migrations) {
      const appliedChecksum = appliedByVersion.get(migration.version);
      if (appliedChecksum !== undefined && appliedChecksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.filename} has been edited after being applied ` +
            `(checksum ${appliedChecksum} in database, ${migration.checksum} on disk). ` +
            'Applied migrations are immutable - add a new migration instead.',
        );
      }
    }
    const missingOnDisk = appliedRows.filter(
      (r) => !migrations.some((m) => m.version === r.version),
    );
    if (missingOnDisk.length > 0) {
      throw new Error(
        `Database has applied migrations missing from disk: ${missingOnDisk
          .map((r) => r.version)
          .join(', ')}`,
      );
    }

    const pending = migrations.filter((m) => !appliedByVersion.has(m.version));
    for (const migration of pending) {
      log(`applying ${migration.filename}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.filename} failed: ${String(error)}`, {
          cause: error,
        });
      }
    }

    return { applied: pending, alreadyApplied: appliedRows.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
