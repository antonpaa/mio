import { Module } from '@nestjs/common';
import { createRolePool } from '@mio/db';
import type pg from 'pg';
import { CONFIG, ConfigModule } from './config.module.js';
import type { ApiConfig } from './config.js';

export const APP_POOL = Symbol('APP_POOL');

/** The application pool: mio_app carrier role, RLS context per transaction. */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: APP_POOL,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): pg.Pool =>
        createRolePool({ connectionString: config.databaseUrl, role: 'mio_app' }),
    },
  ],
  exports: [APP_POOL],
})
export class DbModule {}
