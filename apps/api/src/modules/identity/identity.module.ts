import { Module } from '@nestjs/common';
import type pg from 'pg';
import { APP_POOL, DbModule } from '../../shared/db.module.js';
import { CONFIG, ConfigModule } from '../../shared/config.module.js';
import type { ApiConfig } from '../../shared/config.js';
import { AuthService, PATIENT_TABLES, STAFF_TABLES } from './domain/auth.service.js';
import { OnboardingService } from './domain/onboarding.service.js';
import { LogMailer, MAILER, type Mailer } from './ports/mailer.js';
import { SmtpMailer } from './ports/smtp-mailer.js';
import { PatientAuthController, StaffAuthController } from './http/auth.controller.js';
import {
  PatientOnboardingController,
  StaffOnboardingController,
} from './http/onboarding.controller.js';
import { AdminResetController } from './http/admin-reset.controller.js';
import {
  PATIENT_AUTH,
  PATIENT_ONBOARDING,
  STAFF_AUTH,
  STAFF_ONBOARDING,
} from './identity.tokens.js';

@Module({
  imports: [DbModule, ConfigModule],
  controllers: [
    PatientAuthController,
    StaffAuthController,
    PatientOnboardingController,
    StaffOnboardingController,
    AdminResetController,
  ],
  providers: [
    {
      provide: MAILER,
      useFactory: (): Mailer => {
        const smtpUrl = process.env['MIO_SMTP_URL'];
        return smtpUrl ? new SmtpMailer(smtpUrl) : new LogMailer();
      },
    },
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
    {
      provide: PATIENT_ONBOARDING,
      inject: [APP_POOL, PATIENT_AUTH, MAILER, CONFIG],
      useFactory: (pool: pg.Pool, auth: AuthService, mailer: Mailer, config: ApiConfig) =>
        new OnboardingService(pool, PATIENT_TABLES, auth, mailer, config.publicBaseUrl),
    },
    {
      provide: STAFF_ONBOARDING,
      inject: [APP_POOL, STAFF_AUTH, MAILER, CONFIG],
      useFactory: (pool: pg.Pool, auth: AuthService, mailer: Mailer, config: ApiConfig) =>
        new OnboardingService(pool, STAFF_TABLES, auth, mailer, config.publicBaseUrl),
    },
  ],
  exports: [PATIENT_AUTH, STAFF_AUTH, PATIENT_ONBOARDING, STAFF_ONBOARDING, MAILER],
})
export class IdentityModule {}
