import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, CountBadge, ErrorState, Skeleton, StatusChip } from '@mio/ui';
import { useSession } from '../session/session.js';
import { threadsQuery, type ThreadRow } from './model.js';
import { MessageThreadPage } from './thread-page.js';

/**
 * C4's two-pane inbox: the thread list stays beside the open
 * conversation, selection rides the URL so back/forward and deep links
 * keep working. On small screens the panes collapse to the familiar
 * list -> thread flow. Patients keep P10's single-column list.
 */

const ENDED_STATES = ['completed', 'discontinued'];

function ThreadListPane({ activeId }: { activeId: string | null }): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const myId = session.account?.id ?? '';
  const threads = useQuery(threadsQuery('staff'));
  const [needle, setNeedle] = useState('');

  if (threads.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (threads.isError) return <ErrorState onRetry={() => void threads.refetch()} />;

  const query = needle.trim().toLowerCase();
  const rows = threads.data.filter(
    (row) =>
      query === '' ||
      `${row.patient_given ?? ''} ${row.patient_family ?? ''}`.toLowerCase().includes(query) ||
      row.treatment_name.toLowerCase().includes(query) ||
      (row.last_preview ?? '').toLowerCase().includes(query),
  );

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="nav.messages" />
      </h1>
      <input
        type="search"
        value={needle}
        onChange={(event) => setNeedle(event.currentTarget.value)}
        placeholder={intl.formatMessage({ id: 'messages.searchPlaceholder' })}
        aria-label={intl.formatMessage({ id: 'messages.searchPlaceholder' })}
        className="rounded-pill border border-border bg-surface px-4 py-2 text-sm"
      />
      <ul className="flex max-h-[calc(100dvh-14rem)] flex-col overflow-y-auto rounded-card border border-black/5 bg-surface shadow-resting">
        {rows.length === 0 ? (
          <li className="px-4 py-5 text-sm text-secondary">
            <FormattedMessage id="messages.noThreads" />
          </li>
        ) : (
          rows.map((row: ThreadRow) => {
            const active = row.treatment_id === activeId;
            const ended = ENDED_STATES.includes(row.state);
            const prefix =
              row.last_author_id === myId
                ? intl.formatMessage({ id: 'messages.you' })
                : row.last_author_realm === 'staff'
                  ? (row.last_author_given ?? null)
                  : null;
            return (
              <li key={row.treatment_id} className="border-b border-hairline last:border-b-0">
                <Link
                  to="/messages/$treatmentId"
                  params={{ treatmentId: row.treatment_id }}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-start gap-2.5 border-l-2 px-3.5 py-3 transition-colors ${
                    active
                      ? 'border-teal bg-surface-sunken'
                      : 'border-transparent hover:bg-surface-sunken'
                  }`}
                >
                  <Avatar
                    initials={`${row.patient_given?.[0] ?? ''}${row.patient_family?.[0] ?? ''}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          row.unread > 0
                            ? 'font-semibold text-ink'
                            : 'font-medium text-ink-strong-secondary'
                        }`}
                      >
                        {row.patient_given} {row.patient_family}
                      </span>
                      {row.last_at !== null ? (
                        <span className="shrink-0 text-xs text-muted">
                          {intl.formatDate(row.last_at, { day: 'numeric', month: 'short' })}
                        </span>
                      ) : null}
                      {row.unread > 0 ? (
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-pill bg-teal" />
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-secondary">
                      {row.treatment_name}
                    </span>
                    {row.last_preview !== null ? (
                      <span className="block truncate text-xs text-muted">
                        {prefix !== null ? `${prefix}: ` : ''}
                        {row.last_preview}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1.5 pt-0.5">
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
                  </span>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

export function StaffInbox(): ReactElement {
  const { treatmentId } = useParams({ strict: false }) as { treatmentId?: string };
  const active = treatmentId ?? null;
  return (
    <div className="mx-auto flex max-w-6xl items-start gap-5">
      <aside className={`w-full shrink-0 lg:block lg:w-80 ${active !== null ? 'hidden' : ''}`}>
        <ThreadListPane activeId={active} />
      </aside>
      <div className={`min-w-0 flex-1 ${active === null ? 'hidden lg:block' : ''}`}>
        {active !== null ? (
          <MessageThreadPage />
        ) : (
          <p className="rounded-card border border-black/5 bg-surface px-5 py-10 text-center text-sm text-secondary shadow-resting">
            <FormattedMessage id="messages.pickThread" />
          </p>
        )}
      </div>
    </div>
  );
}
