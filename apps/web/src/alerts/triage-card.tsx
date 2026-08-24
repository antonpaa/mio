import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { ErrorState, IconBell, SeverityChip, Skeleton, StatusChip } from '@mio/ui';
import { ALERT_STATUS_TONE, TRIAGE_QUERY } from './alert-model.js';
import { useSession } from '../session/session.js';

/**
 * C1: the dashboard triage queue - open alerts across the clinician's
 * care patients, new before acknowledged, high before moderate. Each row
 * opens the PP6 detail.
 */
export function TriageCard({ filter = 'all' }: { filter?: 'all' | 'mine' }): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const triage = useQuery(TRIAGE_QUERY);
  // WP-27: the C1 segmented filter narrows the worklist to alerts
  // assigned to the caller; the disclosure is the same audited query
  const rows = (triage.data ?? []).filter(
    (row) => filter === 'all' || row.assignee_id === (session.account?.id ?? ''),
  );

  return (
    <section
      aria-labelledby="triage-title"
      className="rounded-card border border-black/5 bg-surface shadow-resting"
    >
      <header className="flex items-baseline justify-between border-b border-hairline px-5 py-3.5">
        <h2
          id="triage-title"
          className="flex items-center gap-2 font-display text-lg italic text-ink"
        >
          <span className="text-teal">
            <IconBell size={18} />
          </span>
          <FormattedMessage id="alerts.queueTitle" />
        </h2>
        {triage.data ? (
          <p className="text-xs text-muted">
            <FormattedMessage id="alerts.openCount" values={{ count: rows.length }} />
          </p>
        ) : null}
      </header>
      {triage.isPending ? (
        <div className="flex flex-col gap-2 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : triage.isError ? (
        <div className="p-5">
          <ErrorState onRetry={() => void triage.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">
          <FormattedMessage id="alerts.empty" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to="/alerts/$alertId"
                params={{ alertId: row.id }}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-surface-sunken"
              >
                {/* fixed-width chip column so the text column starts aligned
                    whatever the severity label's length */}
                <span className="flex w-28 shrink-0">
                  <SeverityChip
                    severity={row.severity}
                    label={intl.formatMessage({ id: `severity.${row.severity}` })}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {row.patient_given} {row.patient_family}
                  </span>
                  <span className="block truncate text-xs text-secondary">
                    {row.survey_name ?? row.treatment_name} —{' '}
                    {intl.formatDate(row.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </span>
                <span className="hidden text-xs text-muted sm:block">
                  {row.assignee_given !== null ? (
                    `${row.assignee_given} ${row.assignee_family ?? ''}`
                  ) : (
                    <FormattedMessage id="alerts.unassigned" />
                  )}
                </span>
                <StatusChip tone={ALERT_STATUS_TONE[row.status]}>
                  {intl.formatMessage({ id: `alerts.status.${row.status}` })}
                </StatusChip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
