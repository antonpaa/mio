import { useState, type FormEvent, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useNavigate, Link } from '@tanstack/react-router';
import { Button, TextField } from '@mio/ui';
import { login } from '../lib/api.js';

/** L1/L4/L7: sign in, with the inline error and delay states. */
export function SignInPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const [error, setError] = useState<'invalid' | 'delayed' | null>(null);
  const [delayMinutes, setDelayMinutes] = useState(1);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const outcome = await login(
      String(form.get('email') ?? ''),
      String(form.get('password') ?? ''),
    );
    setBusy(false);
    if (outcome.status === 'otp_sent') {
      await navigate({
        to: '/login/verify',
        search: { realm: outcome.realm, challenge: outcome.challengeId },
      });
      return;
    }
    if (outcome.status === 'delayed') {
      setDelayMinutes(Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60)));
      setError('delayed');
      return;
    }
    setError('invalid');
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="login.title" />
        </h1>
        <p className="mt-1 text-sm text-secondary">
          <FormattedMessage id="login.subtitle" />
        </p>
      </div>
      <TextField
        name="email"
        type="email"
        label={intl.formatMessage({ id: 'login.email' })}
        autoComplete="email"
        isRequired
      />
      <TextField
        name="password"
        type="password"
        label={intl.formatMessage({ id: 'login.password' })}
        autoComplete="current-password"
        isRequired
      />
      {error !== null ? (
        <p role="alert" className="rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
          {error === 'invalid' ? (
            <FormattedMessage id="login.invalid" />
          ) : (
            <FormattedMessage id="login.delayed" values={{ minutes: delayMinutes }} />
          )}
        </p>
      ) : null}
      <Button type="submit" isDisabled={busy}>
        <FormattedMessage id="login.continue" />
      </Button>
      <div className="flex flex-col gap-2 text-center text-sm">
        <Link to="/login/forgot" className="text-teal hover:text-teal-hover">
          <FormattedMessage id="login.forgot" />
        </Link>
        <p className="text-xs leading-relaxed text-muted">
          <FormattedMessage id="login.firstTime" />
        </p>
      </div>
    </form>
  );
}
