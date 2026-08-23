import { createTransport, type Transporter } from 'nodemailer';
import type { NotificationMail } from './notification-dispatch.js';

/**
 * The dispatch's contentless email nudge (S4): type and deep link only,
 * never a word of content - the designed template says exactly this to
 * the recipient. Without MIO_SMTP_URL (dev, tests) mails are logged as
 * JSON, mirroring the API's dev behaviour.
 */

const COPY: Record<string, { subject: string; body: string }> = {
  en: {
    subject: 'Something is waiting for you in Mio',
    body: 'Something is waiting for you. Sign in to Mio to see it:',
  },
  fi: {
    subject: 'Sinulle on odottavaa Miossa',
    body: 'Sinulle on jotakin odottamassa. Kirjaudu Mioon nähdäksesi sen:',
  },
  sv: {
    subject: 'Något väntar på dig i Mio',
    body: 'Något väntar på dig. Logga in i Mio för att se det:',
  },
};

export function createNotificationSender(): (mail: NotificationMail) => Promise<void> {
  const smtpUrl = process.env['MIO_SMTP_URL'];
  const baseUrl = process.env['MIO_PUBLIC_URL'] ?? 'http://localhost:5173';
  const from = process.env['MIO_MAIL_FROM'] ?? 'Mio <no-reply@mio.example>';
  const transport: Transporter | undefined = smtpUrl ? createTransport(smtpUrl) : undefined;

  return async (mail) => {
    const copy = COPY[mail.locale] ?? COPY['en']!;
    const link = `${baseUrl}${mail.link}`;
    if (!transport) {
      console.error(
        JSON.stringify({
          level: 'info',
          msg: 'notification mail (no SMTP configured)',
          mail: { recipient: mail.recipient, type: mail.type },
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
