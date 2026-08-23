import { createTransport, type Transporter } from 'nodemailer';
import type { ReminderMail } from './survey-sweep.js';

/**
 * The worker's contentless reminder sender. Same structural guarantee as
 * the identity mailer (apps/api adapters): TYPE AND DEEPLINK ONLY - the
 * mail never says which survey, which program, or anything clinical. When
 * MIO_SMTP_URL is absent (dev, tests) the mail is logged as JSON instead,
 * mirroring the API's dev behaviour.
 */

const COPY: Record<string, { subject: string; body: string }> = {
  en: {
    subject: 'Something is waiting for you in Mio',
    body: 'You have something to fill in. Sign in to Mio to see it:',
  },
  fi: {
    subject: 'Sinulle on odottavaa Miossa',
    body: 'Sinulla on jotakin täytettävää. Kirjaudu Mioon nähdäksesi sen:',
  },
  sv: {
    subject: 'Något väntar på dig i Mio',
    body: 'Du har något att fylla i. Logga in i Mio för att se det:',
  },
};

export function createReminderSender(): (mail: ReminderMail) => Promise<void> {
  const smtpUrl = process.env['MIO_SMTP_URL'];
  const baseUrl = process.env['MIO_PUBLIC_URL'] ?? 'http://localhost:5173';
  const from = process.env['MIO_MAIL_FROM'] ?? 'Mio <no-reply@mio.example>';
  const transport: Transporter | undefined = smtpUrl ? createTransport(smtpUrl) : undefined;

  return async (mail) => {
    const copy = COPY[mail.locale] ?? COPY['en']!;
    const link = `${baseUrl}/surveys`;
    if (!transport) {
      console.error(
        JSON.stringify({
          level: 'info',
          msg: 'reminder mail (no SMTP configured)',
          mail: { recipient: mail.recipient, type: 'survey_reminder' },
        }),
      );
      return;
    }
    await transport.sendMail({
      from,
      to: mail.recipient,
      subject: copy.subject,
      text: `${copy.body}\n\n${link}\n`,
    });
  };
}
