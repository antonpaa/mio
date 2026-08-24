import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { CountBadge, ErrorState, IconMessages, Skeleton, StatusChip } from '@mio/ui';
import { useSession } from '../session/session.js';
import { threadsQuery, type ThreadRow } from './model.js';

/**
 * P10 (patient) and the list half of C4 (clinician): one row per
 * programme thread. Ended programmes stay in the list, marked - their
 * messages are kept for reading.
 */

const ENDED_STATES = ['completed', 'discontinued'];

export function MessagesPage(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const realm = session.realm === 'patient' ? ('patient' as const) : ('staff' as const);
  const threads = useQuery(threadsQuery(realm));

  if (threads.isPending) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (threads.isError) return <ErrorState onRetry={() => void threads.refetch()} />;

  const rows = threads.data;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="nav.messages" />
      </h1>
      {realm === 'patient' ? (
        <p className="text-sm text-secondary">
          <FormattedMessage id="messages.expectation" />{' '}
          <span className="text-ink-strong-secondary">
            <FormattedMessage id="messages.emergency" />
          </span>
        </p>
      ) : null}
      <section className="rounded-card border border-black/5 bg-surface shadow-resting">
        <header className="flex items-center gap-2 border-b border-hairline px-5 py-3.5">
          <span className="text-teal">
            <IconMessages size={17} />
          </span>
          <h2 className="text-sm font-semibold text-ink">
            <FormattedMessage id="messages.threadsTitle" />
          </h2>
        </header>
        {rows.length === 0 ? (
          <p className="px-5 py-5 text-sm text-secondary">
            <FormattedMessage id="messages.noThreads" />
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((row: ThreadRow) => {
              const ended = ENDED_STATES.includes(row.state);
              return (
                <li key={row.treatment_id}>
                  <Link
                    to="/messages/$treatmentId"
                    params={{ treatmentId: row.treatment_id }}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm ${row.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-strong-secondary'}`}
                        >
                          {realm === 'staff'
                            ? `${row.patient_given ?? ''} ${row.patient_family ?? ''} — ${row.treatment_name}`
                            : row.treatment_name}
                        </span>
                        {row.unread > 0 ? (
                          <CountBadge
                            count={row.unread}
                            label={intl.formatMessage(
                              { id: 'messages.unread' },
                              { count: row.unread },
                            )}
                          />
                        ) : null}
                        {ended ? (
                          <StatusChip tone="neutral">
                            {intl.formatMessage({ id: 'messages.ended' })}
                          </StatusChip>
                        ) : null}
                      </span>
                      {row.last_preview !== null ? (
                        <span className="block truncate text-sm text-secondary">
                          {row.last_preview}
                        </span>
                      ) : (
                        <span className="block text-sm italic text-muted">
                          <FormattedMessage id="messages.none" />
                        </span>
                      )}
                    </span>
                    {row.last_at !== null ? (
                      <span className="shrink-0 text-xs text-muted">
                        {intl.formatDate(row.last_at, { day: 'numeric', month: 'short' })}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
