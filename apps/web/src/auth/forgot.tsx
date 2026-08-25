import { useState, type FormEvent, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button, TextField } from '@mio/ui';
import { completeReset, requestReset, type Realm } from '../lib/api.js';

/** L5: request a reset link. Always succeeds outwardly - never an oracle. */
export function ForgotPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    await requestReset(String(new FormData(event.currentTarget).get('email') ?? ''));
    await navigate({ to: '/login/forgot/sent' });
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="forgot.title" />
        </h1>
        <p className="mt-1 text-sm text-secondary">
          <FormattedMessage id="forgot.subtitle" />
        </p>
      </div>
      <TextField
        name="email"
        type="email"
        label={intl.formatMessage({ id: 'login.email' })}
        autoComplete="email"
        isRequired
      />
      <Button type="submit" isDisabled={busy}>
        <FormattedMessage id="forgot.submit" />
      </Button>
      <Link to="/login" className="text-center text-sm text-secondary hover:text-ink">
        <FormattedMessage id="forgot.back" />
      </Link>
    </form>
  );
}

/** L6: the calm confirmation. */
export function ForgotSentPage(): ReactElement {
  return (
    <div className="flex flex-col gap-4 text-center">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="forgotSent.title" />
      </h1>
      <p className="text-sm leading-relaxed text-secondary">
        <FormattedMessage id="forgotSent.body" />
      </p>
      <Link to="/login" className="text-sm text-teal hover:text-teal-hover">
        <FormattedMessage id="forgotSent.back" />
      </Link>
      <Link to="/login/forgot" className="text-sm text-secondary hover:text-ink">
        <FormattedMessage id="forgotSent.again" />
      </Link>
    </div>
  );
}

/** The mailed /reset/:token page - realm resolved by trying both. */
export function ResetPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token: string };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setBusy(true);
    setError(null);
    for (const realm of ['patient', 'staff'] as const satisfies readonly Realm[]) {
      const outcome = await completeReset(realm, token, password);
      if (outcome.status === 'ok') {
        await navigate({ to: '/login' });
        return;
      }
      if (outcome.status === 'policy') {
        setBusy(false);
        setError(outcome.message);
        return;
      }
    }
    setBusy(false);
    setError(intl.formatMessage({ id: 'reset.invalid' }));
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="reset.title" />
      </h1>
      <TextField
        name="password"
        type="password"
        label={intl.formatMessage({ id: 'welcome.password' })}
        autoComplete="new-password"
        isRequired
        reveal={{
          show: intl.formatMessage({ id: 'login.showPassword' }),
          hide: intl.formatMessage({ id: 'login.hidePassword' }),
        }}
      />
      {error !== null ? (
        <p role="alert" className="rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={busy}>
        <FormattedMessage id="reset.submit" />
      </Button>
      <Link to="/login/forgot" className="text-center text-sm text-secondary hover:text-ink">
        <FormattedMessage id="forgot.title" />
      </Link>
    </form>
  );
}
