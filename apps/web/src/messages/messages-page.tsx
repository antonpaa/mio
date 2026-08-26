import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, CountBadge, ErrorState, IconMessages, Skeleton, StatusChip } from '@mio/ui';
import { useSession } from '../session/session.js';
import { threadsQuery, type ThreadRow } from './model.js';

/**
 * P10: the patient's thread list - one row per programme, previews
 * prefixed with who wrote last ("Mikael: ...", "You: ..."), the care
 * team named under the programme. Ended programmes stay in the list,
 * marked - their messages are kept for reading. The staff surface is
 * the C4 two-pane inbox (inbox.tsx).
 */

const ENDED_STATES = ['completed', 'discontinued'];

export function MessagesPage(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const myId = session.account?.id ?? '';
  const threads = useQuery(threadsQuery('patient'));

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
      <p className="text-sm text-secondary">
        <FormattedMessage id="messages.expectation" />
      </p>
      <section className="rounded-card border border-black/5 bg-surface shadow-resting">
        <header className="flex items-center gap-2 border-b border-hairline px-5 py-3.5">
          <span className="text-teal">
            <IconMessages size={17} />
          </span>
          <h2 className="font-display text-lg italic text-ink">
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
              // the preview names its author: the care-team member's
              // given name, or "You" for the patient's own last word
              const prefix =
                row.last_author_id === myId
                  ? intl.formatMessage({ id: 'messages.you' })
                  : row.last_author_realm === 'staff'
                    ? (row.last_author_given ?? null)
                    : null;
              return (
                <li key={row.treatment_id}>
                  <Link
                    to="/messages/$treatmentId"
                    params={{ treatmentId: row.treatment_id }}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                  >
                    <Avatar
                      initials={row.last_author_given?.[0] ?? row.treatment_name[0] ?? ''}
                      {...(row.last_author_given !== null && row.last_author_given !== undefined
                        ? { label: row.last_author_given }
                        : {})}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm ${row.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-strong-secondary'}`}
                        >
                          {row.treatment_name}
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
                      {row.team_name !== null && row.team_name !== undefined ? (
                        <span className="block truncate text-xs text-secondary">
                          <FormattedMessage
                            id="messages.careTeamLine"
                            values={{ team: row.team_name }}
                          />
                        </span>
                      ) : null}
                      {row.last_preview !== null ? (
                        <span className="block truncate text-sm text-secondary">
                          {prefix !== null ? `${prefix}: ` : ''}
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
