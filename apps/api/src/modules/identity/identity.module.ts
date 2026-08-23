import { Module } from '@nestjs/common';
import type pg from 'pg';
import { APP_POOL, DbModule } from '../../shared/db.module.js';
import { CONFIG, ConfigModule } from '../../shared/config.module.js';
import type { ApiConfig } from '../../shared/config.js';
import { AuthService, PATIENT_TABLES, STAFF_TABLES } from './domain/auth.service.js';
import { LogMailer, MAILER, type Mailer } from './ports/mailer.js';
import { PatientAuthController, StaffAuthController } from './http/auth.controller.js';
import { PATIENT_AUTH, STAFF_AUTH } from './identity.tokens.js';

@Module({
  imports: [DbModule, ConfigModule],
  controllers: [PatientAuthController, StaffAuthController],
  providers: [
    { provide: MAILER, useClass: LogMailer },
    {
      provide: PATIENT_AUTH,
      inject: [APP_POOL, MAILER, CONFIG],
      useFactory: (pool: pg.Pool, mailer: Mailer, config: ApiConfig) =>
        new AuthService(pool, PATIENT_TABLES, mailer, config.otpPepper),
    },
    {
      provide: STAFF_AUTH,
      inject: [APP_POOL, MAILER, CONFIG],
      useFactory: (pool: pg.Pool, mailer: Mailer, config: ApiConfig) =>
        new AuthService(pool, STAFF_TABLES, mailer, config.otpPepper),
    },
  ],
  exports: [PATIENT_AUTH, STAFF_AUTH],
})
export class IdentityModule {}
