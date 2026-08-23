import { createTransport, type Transporter } from 'nodemailer';
import type { ContentlessMail, MailKind, Mailer } from './mailer.js';

/**
 * The real mail layer over SMTP (Mailpit locally, an EU relay in
 * production - ADR-0010). Subjects and bodies per S4: they say something
 * is waiting and never what. The ContentlessMail type already guarantees
 * no clinical field can reach this file.
 */

const FROM = 'Mio <noreply@mio.health>';

type Copy = { subject: string; body: (mail: ContentlessMail) => string };

const COPY: Record<MailKind, Record<'en' | 'fi' | 'sv', Copy>> = {
  welcome_invite: {
    en: {
      subject: 'Your care team invited you to Mio',
      body: (m) =>
        `Hello,\n\nYour care team invited you to Mio, a service you use together to follow how you are doing between visits.\n\nCreate your password here:\n${m.deepLink}\n\nThe link works for 7 days. For your privacy, Mio emails never include health information.\n\nCare, together — Mio`,
    },
    fi: {
      subject: 'Hoitotiimisi kutsui sinut Mioon',
      body: (m) =>
        `Hei,\n\nHoitotiimisi kutsui sinut Mioon.\n\nLuo salasanasi tästä:\n${m.deepLink}\n\nLinkki toimii 7 päivää. Yksityisyytesi vuoksi Mion sähköpostit eivät koskaan sisällä terveystietoja.\n\nHoitoa yhdessä — Mio`,
    },
    sv: {
      subject: 'Ditt vårdteam bjöd in dig till Mio',
      body: (m) =>
        `Hej,\n\nDitt vårdteam bjöd in dig till Mio.\n\nSkapa ditt lösenord här:\n${m.deepLink}\n\nLänken fungerar i 7 dagar. För din integritet innehåller Mios e-post aldrig hälsouppgifter.\n\nVård, tillsammans — Mio`,
    },
  },
  login_code: {
    en: {
      subject: 'Your Mio sign-in code',
      body: (m) =>
        `Your sign-in code is:\n\n${m.code}\n\nIt works for 10 minutes. If you did not try to sign in, you can ignore this email.\n\nCare, together — Mio`,
    },
    fi: {
      subject: 'Mio-kirjautumiskoodisi',
      body: (m) =>
        `Kirjautumiskoodisi on:\n\n${m.code}\n\nKoodi toimii 10 minuuttia. Jos et yrittänyt kirjautua, voit jättää tämän viestin huomiotta.\n\nHoitoa yhdessä — Mio`,
    },
    sv: {
      subject: 'Din inloggningskod till Mio',
      body: (m) =>
        `Din inloggningskod är:\n\n${m.code}\n\nKoden fungerar i 10 minuter. Om du inte försökte logga in kan du ignorera detta meddelande.\n\nVård, tillsammans — Mio`,
    },
  },
  password_reset: {
    en: {
      subject: 'Reset your Mio password',
      body: (m) =>
        `Reset your password here:\n\n${m.deepLink}\n\nThe link works for 60 minutes. If you did not request this, you can ignore this email.\n\nCare, together — Mio`,
    },
    fi: {
      subject: 'Palauta Mio-salasanasi',
      body: (m) =>
        `Palauta salasanasi tästä:\n\n${m.deepLink}\n\nLinkki toimii 60 minuuttia. Jos et pyytänyt tätä, voit jättää viestin huomiotta.\n\nHoitoa yhdessä — Mio`,
    },
    sv: {
      subject: 'Återställ ditt Mio-lösenord',
      body: (m) =>
        `Återställ ditt lösenord här:\n\n${m.deepLink}\n\nLänken fungerar i 60 minuter. Om du inte begärde detta kan du ignorera meddelandet.\n\nVård, tillsammans — Mio`,
    },
  },
  login_reset_by_admin: {
    en: {
      subject: 'Your Mio sign-in was reset',
      body: (m) =>
        `An administrator reset your Mio sign-in. Your data is untouched.\n\nSet a new password here:\n${m.deepLink}\n\nThe link works for 7 days.\n\nCare, together — Mio`,
    },
    fi: {
      subject: 'Mio-kirjautumisesi nollattiin',
      body: (m) =>
        `Ylläpitäjä nollasi Mio-kirjautumisesi. Tietosi eivät ole muuttuneet.\n\nAseta uusi salasana tästä:\n${m.deepLink}\n\nLinkki toimii 7 päivää.\n\nHoitoa yhdessä — Mio`,
    },
    sv: {
      subject: 'Din Mio-inloggning återställdes',
      body: (m) =>
        `En administratör återställde din Mio-inloggning. Dina uppgifter är oförändrade.\n\nAnge ett nytt lösenord här:\n${m.deepLink}\n\nLänken fungerar i 7 dagar.\n\nVård, tillsammans — Mio`,
    },
  },
};

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(smtpUrl: string) {
    this.transport = createTransport(smtpUrl);
  }

  async send(mail: ContentlessMail): Promise<void> {
    const copy = COPY[mail.kind][mail.locale];
    await this.transport.sendMail({
      from: FROM,
      to: mail.recipient,
      subject: copy.subject,
      text: copy.body(mail),
    });
  }
}
