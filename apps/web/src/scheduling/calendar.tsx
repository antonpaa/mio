import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { EmptyState, ErrorState, Skeleton, StatusChip } from '@mio/ui';

/**
 * P9: the patient's consolidated calendar - every planned or confirmed
 * activity across programmes, grouped by day, TODAY first.
 */

interface CalendarRow {
  id: string;
  occurrence_date: string | null;
  title: string;
  kind: 'visit' | 'lab' | 'infusion' | 'survey' | 'other';
  location: string | null;
  scheduled_at: string | null;
  status: 'planned' | 'confirmed';
  treatment_name: string;
}

function localDay(row: CalendarRow): string {
  if (row.occurrence_date) return row.occurrence_date;
  if (row.scheduled_at) {
    const at = new Date(row.scheduled_at);
    const month = String(at.getMonth() + 1).padStart(2, '0');
    const day = String(at.getDate()).padStart(2, '0');
    return `${at.getFullYear()}-${month}-${day}`;
  }
  return '';
}

export function PatientCalendarPage(): ReactElement {
  const intl = useIntl();
  const calendar = useQuery({
    queryKey: ['calendar'],
    queryFn: async () => {
      const response = await fetch('/api/patient/calendar', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`calendar: ${response.status}`);
      return (await response.json()) as CalendarRow[];
    },
    retry: false,
  });

  if (calendar.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (calendar.isError) return <ErrorState onRetry={() => void calendar.refetch()} />;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const groups = new Map<string, CalendarRow[]>();
  for (const row of calendar.data) {
    const day = localDay(row);
    if (day === '') continue;
    const bucket = groups.get(day);
    if (bucket) bucket.push(row);
    else groups.set(day, [row]);
  }
  const days = [...groups.keys()].sort();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="calendar.title" />
      </h1>
      {days.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'calendar.emptyTitle' })}>
          <FormattedMessage id="calendar.empty" />
        </EmptyState>
      ) : (
        days.map((day) => {
          const noon = `${day}T12:00:00`;
          const isToday = day === today;
          const isPast = day < today;
          return (
            <section
              key={day}
              aria-label={intl.formatDate(noon, { dateStyle: 'full' })}
              className={isPast ? 'opacity-70' : undefined}
            >
              <h2 className="mb-1.5 flex items-baseline gap-2 text-sm">
                {isToday ? (
                  <span className="font-semibold uppercase tracking-wide text-teal">
                    <FormattedMessage id="calendar.today" />
                  </span>
                ) : (
                  <span className="font-semibold text-ink">
                    {intl.formatDate(noon, { weekday: 'long' })}
                  </span>
                )}
                <span className="text-muted">
                  {intl.formatDate(noon, { day: 'numeric', month: 'long' })}
                </span>
              </h2>
              <ul className="overflow-hidden rounded-card border border-black/5 bg-surface shadow-resting">
                {(groups.get(day) ?? []).map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
                  >
                    <div className="w-14 shrink-0 text-sm font-medium text-ink">
                      {row.scheduled_at !== null ? (
                        intl.formatTime(row.scheduled_at, { hour: '2-digit', minute: '2-digit' })
                      ) : (
                        <span className="text-xs uppercase tracking-wide text-muted">
                          <FormattedMessage id="calendar.allDay" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{row.title}</p>
                      <p className="truncate text-xs text-secondary">
                        {row.treatment_name}
                        {row.location ? ` · ${row.location}` : ''}
                      </p>
                    </div>
                    {row.status === 'confirmed' ? (
                      <StatusChip tone="teal">
                        {intl.formatMessage({ id: 'activity.status.confirmed' })}
                      </StatusChip>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      <p className="text-xs leading-relaxed text-muted">
        <FormattedMessage id="calendar.note" />
      </p>
    </div>
  );
}
