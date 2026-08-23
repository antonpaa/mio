/**
 * The contentless mail port (structural guarantee 3): the payload type has
 * NO clinical fields, so an email containing clinical content is a compile
 * error. WP-07 adds the SMTP implementation and templates; the log mailer
 * keeps development honest meanwhile.
 */

export type MailKind = 'welcome_invite' | 'login_code' | 'password_reset' | 'login_reset_by_admin';

export interface ContentlessMail {
  recipient: string;
  kind: MailKind;
  locale: 'en' | 'fi' | 'sv';
  /** Link into Mio; for codes, the code itself (a credential, not content). */
  deepLink?: string;
  code?: string;
}

export interface Mailer {
  send(mail: ContentlessMail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

export class LogMailer implements Mailer {
  async send(mail: ContentlessMail): Promise<void> {
    // Dev visibility only; the code is a short-lived credential.
    console.error(
      JSON.stringify({
        level: 'info',
        src: 'mailer',
        kind: mail.kind,
        to: mail.recipient,
        code: mail.code,
        link: mail.deepLink,
      }),
    );
  }
}
