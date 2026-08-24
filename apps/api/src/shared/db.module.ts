import { Module } from '@nestjs/common';
import { createRolePool } from '@mio/db';
import type pg from 'pg';
import { CONFIG, ConfigModule } from './config.module.js';
import type { ApiConfig } from './config.js';

export const APP_POOL = Symbol('APP_POOL');
export const AUDIT_READER_POOL = Symbol('AUDIT_READER_POOL');

/** The application pool: mio_app carrier role, RLS context per transaction.
 * The audit reader is a SEPARATE narrowly-used carrier: the app role
 * stays INSERT-only on audit.*, and only the designed self-service
 * feature ("Who has viewed my records", WP-26) reads through this one. */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: APP_POOL,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): pg.Pool =>
        createRolePool({ connectionString: config.databaseUrl, role: 'mio_app' }),
    },
    {
      provide: AUDIT_READER_POOL,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): pg.Pool =>
        createRolePool({ connectionString: config.databaseUrl, role: 'mio_audit_reader' }),
    },
  ],
  exports: [APP_POOL, AUDIT_READER_POOL],
})
export class DbModule {}
