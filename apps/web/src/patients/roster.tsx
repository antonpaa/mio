import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, EmptyState, ErrorState, ListRow, Skeleton } from '@mio/ui';

interface RosterRow {
  patientId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  locale: string;
}

async function fetchRoster(): Promise<RosterRow[]> {
  const response = await fetch('/api/staff/patients', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`roster failed: ${response.status}`);
  return (await response.json()) as RosterRow[];
}

function age(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  if (
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
  ) {
    years -= 1;
  }
  return years;
}

/** C3, first slice: the care-relationship-scoped patient list. Columns for
 * alerts, surveys and next activity arrive with their work packages. */
export function RosterPage(): ReactElement {
  const intl = useIntl();
  const [query, setQuery] = useState('');
  const roster = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });

  if (roster.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (roster.isError) {
    return <ErrorState onRetry={() => void roster.refetch()} />;
  }

  const needle = query.trim().toLowerCase();
  const rows = roster.data.filter(
    (row) =>
      needle === '' ||
      `${row.givenName} ${row.familyName}`.toLowerCase().includes(needle) ||
      row.patientId.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="nav.patients" />
        </h1>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={intl.formatMessage({ id: 'roster.search' })}
          aria-label={intl.formatMessage({ id: 'roster.search' })}
          className="w-64 rounded-pill border border-border bg-surface px-4 py-2 text-sm"
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'roster.emptyTitle' })}>
          <FormattedMessage id="roster.emptyBody" />
        </EmptyState>
      ) : (
        <div className="rounded-card border border-black/5 bg-surface px-5 shadow-resting">
          {rows.map((row) => {
            const years = age(row.dateOfBirth);
            return (
              <ListRow
                key={row.patientId}
                leading={
                  <Avatar initials={`${row.givenName[0] ?? ''}${row.familyName[0] ?? ''}`} />
                }
                trailing={
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: row.patientId }}
                    className="text-teal hover:text-teal-hover"
                  >
                    <FormattedMessage id="roster.open" />
                  </Link>
                }
              >
                <p className="text-sm font-medium text-ink">
                  {row.givenName} {row.familyName}
                  {years !== null ? (
                    <span className="ml-2 text-xs font-normal text-muted">{years}</span>
                  ) : null}
                </p>
              </ListRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
