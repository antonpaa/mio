import { useState, type FormEvent, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Button, TextField } from '@mio/ui';
import { resendOtp, verifyOtp, type Realm } from '../lib/api.js';
import { useSession } from '../session/session.js';

/** L2: the email code step. */
export function VerifyPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { realm?: Realm; challenge?: string };
  const session = useSession();
  const [error, setError] = useState<'invalid' | 'expired' | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const realm = search.realm ?? 'patient';
  const challenge = search.challenge ?? '';

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '');
    setBusy(true);
    setError(null);
    const outcome = await verifyOtp(realm, challenge, code);
    setBusy(false);
    if (outcome.status === 'signed_in') {
      session.establish(realm, outcome.account);
      await navigate({ to: '/' });
      return;
    }
    setError(outcome.status);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="verify.title" />
        </h1>
        <p className="mt-1 text-sm text-secondary">
          <FormattedMessage id="verify.sent" />
        </p>
      </div>
      <TextField
        name="code"
        label={intl.formatMessage({ id: 'verify.code' })}
        autoComplete="one-time-code"
        inputMode="numeric"
        isRequired
      />
      {error !== null ? (
        <p role="alert" className="rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
          <FormattedMessage id={error === 'expired' ? 'verify.expired' : 'verify.invalid'} />
        </p>
      ) : null}
      {resent ? (
        <p role="status" className="text-sm text-teal">
          <FormattedMessage id="verify.resent" />
        </p>
      ) : null}
      <Button type="submit" isDisabled={busy}>
        <FormattedMessage id="verify.continue" />
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Link to="/login" className="text-secondary hover:text-ink">
          <FormattedMessage id="verify.back" />
        </Link>
        <button
          type="button"
          className="text-teal hover:text-teal-hover"
          onClick={() => {
            void resendOtp(realm, challenge).then(() => setResent(true));
          }}
        >
          <FormattedMessage id="verify.resend" />
        </button>
      </div>
      <p className="text-center text-xs text-muted">
        <FormattedMessage id="verify.why" />
      </p>
    </form>
  );
}
