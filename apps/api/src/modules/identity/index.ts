export { IdentityModule } from './identity.module.js';
export {
  PATIENT_AUTH,
  PATIENT_ONBOARDING,
  STAFF_AUTH,
  STAFF_ONBOARDING,
} from './identity.tokens.js';
export type { AuthService } from './domain/auth.service.js';
export type { OnboardingService } from './domain/onboarding.service.js';
export { CURRENT_TERMS_VERSION } from './domain/terms.js';
// the admin plane's step-up re-verifies the administrator's own password
export { verifyPassword } from './domain/passwords.js';
export { MAILER, type ContentlessMail, type MailKind, type Mailer } from './ports/mailer.js';
