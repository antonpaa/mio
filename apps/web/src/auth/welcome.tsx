import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Button, TextField } from '@mio/ui';
import { acceptInvite, inspectInvite, type Realm } from '../lib/api.js';

/**
 * L3: first login from the invitation - password + terms in one step.
 * The link does not carry the realm; the page resolves it by asking both.
 */
export function WelcomePage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token: string };
  const [invite, setInvite] = useState<
    | { state: 'loading' }
    | { state: 'invalid' }
    | { state: 'ok'; realm: Realm; givenName: string; email: string }
  >({ state: 'loading' });
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const realm of ['patient', 'staff'] as const) {
        const result = await inspectInvite(realm, token);
        if (result.status === 'ok') {
          if (!cancelled) setInvite({ state: 'ok', realm, ...result });
          return;
        }
      }
      if (!cancelled) setInvite({ state: 'invalid' });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (invite.state === 'loading') return <p className="text-sm text-secondary">…</p>;
  if (invite.state === 'invalid') {
    return (
      <p role="alert" className="text-sm leading-relaxed text-secondary">
        <FormattedMessage id="welcome.invalid" />
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (invite.state !== 'ok' || !terms) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setBusy(true);
    setError(null);
    const outcome = await acceptInvite(invite.realm, token, password);
    setBusy(false);
    if (outcome.status === 'otp_sent') {
      await navigate({
        to: '/login/verify',
        search: { realm: invite.realm, challenge: outcome.challengeId },
      });
      return;
    }
    setError(
      outcome.status === 'policy' ? outcome.message : intl.formatMessage({ id: 'welcome.invalid' }),
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="welcome.title" values={{ name: invite.givenName }} />
        </h1>
        <p className="mt-1 text-sm text-secondary">
          <FormattedMessage id="welcome.subtitle" />
        </p>
      </div>
      <TextField
        name="password"
        type="password"
        label={intl.formatMessage({ id: 'welcome.password' })}
        autoComplete="new-password"
        isRequired
        description={`${intl.formatMessage({ id: 'welcome.rule.length' })} — ${intl.formatMessage({ id: 'welcome.rule.personal' })}`}
        reveal={{
          show: intl.formatMessage({ id: 'login.showPassword' }),
          hide: intl.formatMessage({ id: 'login.hidePassword' }),
        }}
      />
      <label className="flex items-start gap-2 text-sm leading-relaxed text-ink-strong-secondary">
        <input
          type="checkbox"
          checked={terms}
          onChange={(event) => setTerms(event.currentTarget.checked)}
          className="mt-1 accent-[var(--color-teal)]"
        />
        <span>
          <FormattedMessage
            id="welcome.terms"
            values={{
              terms: (
                <a href="/terms" className="text-teal underline">
                  <FormattedMessage id="welcome.terms.link" />
                </a>
              ),
              privacy: (
                <a href="/privacy" className="text-teal underline">
                  <FormattedMessage id="welcome.privacy.link" />
                </a>
              ),
            }}
          />
        </span>
      </label>
      {error !== null ? (
        <p role="alert" className="rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={busy || !terms}>
        <FormattedMessage id="welcome.submit" />
      </Button>
      <p className="text-center text-xs text-muted">
        <FormattedMessage id="welcome.help" />
      </p>
    </form>
  );
}
