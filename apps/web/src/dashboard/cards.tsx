import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Button,
  ErrorState,
  IconCalendar,
  IconMessages,
  IconSurveys,
  Skeleton,
  StatusChip,
} from '@mio/ui';
import { threadsQuery } from '../messages/model.js';

/**
 * The C1 completion (WP-27): the overdue worklist with the manual
 * reminder, the week's agenda, and the unread-conversations slice. Each
 * card is its own audited disclosure server-side and carries C6's empty
 * and error states.
 */

interface OverdueRow {
  id: string;
  patient_id: string;
  occurrence_date: string;
  reminded_at: string | null;
  treatment_name: string;
  patient_given: string;
  patient_family: string;
  survey_name: string | null;
}

interface AgendaRow {
  id: string;
  patient_given: string;
  patient_family: string;
  title: string;
  location: string | null;
  occurrence_date: string | null;
  scheduled_at: string | null;
  treatment_name: string;
}

function CardShell({
  icon,
  titleId,
  to,
  linkId,
  children,
}: {
  icon: ReactNode;
  titleId: string;
  /** the card's labeled action link, per the C1 canvas ("Open calendar",
   * "Open messages") - given only where a full page actually exists */
  to?: string;
  linkId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      aria-labelledby={`${titleId}-heading`}
      className="rounded-card border border-black/5 bg-surface shadow-resting"
    >
      <header className="flex items-center gap-2 border-b border-hairline px-5 py-3">
        <span className="text-teal">{icon}</span>
        <h2 id={`${titleId}-heading`} className="flex-1 font-display text-lg italic text-ink">
          <FormattedMessage id={titleId} />
        </h2>
        {to !== undefined && linkId !== undefined ? (
          <Link
            to={to}
            className="text-sm font-medium text-teal underline-offset-4 hover:underline"
          >
            <FormattedMessage id={linkId} />
          </Link>
        ) : null}
      </header>
      <div className="px-5 py-3">{children}</div>
    </section>
  );
}

export function OverdueCard(): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const overdue = useQuery({
    queryKey: ['overdue'],
    queryFn: async (): Promise<OverdueRow[]> => {
      const response = await fetch('/api/staff/dashboard/overdue', {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`overdue: ${response.status}`);
      return (await response.json()) as OverdueRow[];
    },
    retry: false,
  });
  const remind = useMutation({
    mutationFn: async (activityId: string) => {
      const response = await fetch(`/api/staff/activities/${activityId}/remind`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`remind: ${response.status}`);
      return (await response.json()) as { sent: boolean; reason?: string };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['overdue'] }),
  });

  return (
    <CardShell icon={<IconSurveys size={17} />} titleId="dashboard.overdueTitle">
      {overdue.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : overdue.isError ? (
        <ErrorState onRetry={() => void overdue.refetch()} />
      ) : overdue.data.length === 0 ? (
        <p className="py-1 text-sm text-muted">
          <FormattedMessage id="dashboard.noOverdue" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {overdue.data.map((row) => {
            const declined =
              remind.variables === row.id && remind.data?.sent === false ? true : false;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">
                    {row.patient_given} {row.patient_family}
                  </span>
                  <span className="block text-xs text-secondary">
                    {row.survey_name ?? row.treatment_name} —{' '}
                    {intl.formatDate(`${row.occurrence_date}T12:00:00`, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </span>
                {declined ? (
                  <StatusChip tone="neutral">
                    {intl.formatMessage({ id: 'dashboard.emailOff' })}
                  </StatusChip>
                ) : row.reminded_at !== null ? (
                  <StatusChip tone="teal">
                    {intl.formatMessage({ id: 'dashboard.reminded' })}
                  </StatusChip>
                ) : (
                  <Button
                    size="sm"
                    variant="quiet"
                    onPress={() => remind.mutate(row.id)}
                    isDisabled={remind.isPending}
                  >
                    <FormattedMessage id="dashboard.remind" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}

export function AgendaCard(): ReactElement {
  const intl = useIntl();
  const agenda = useQuery({
    queryKey: ['agenda'],
    queryFn: async (): Promise<AgendaRow[]> => {
      const response = await fetch('/api/staff/dashboard/agenda', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`agenda: ${response.status}`);
      return (await response.json()) as AgendaRow[];
    },
    retry: false,
  });

  const today = new Date().toISOString().slice(0, 10);
  const dayOf = (row: AgendaRow): string =>
    (row.occurrence_date ?? row.scheduled_at ?? '').slice(0, 10);

  return (
    <CardShell
      icon={<IconCalendar size={17} />}
      titleId="dashboard.agendaTitle"
      to="/calendar"
      linkId="home.openCalendar"
    >
      {agenda.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : agenda.isError ? (
        <ErrorState onRetry={() => void agenda.refetch()} />
      ) : agenda.data.length === 0 ? (
        <p className="py-1 text-sm text-muted">
          <FormattedMessage id="dashboard.noAgenda" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {agenda.data.slice(0, 6).map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2.5">
              <span className="w-16 shrink-0 text-xs font-medium text-ink-strong-secondary">
                {dayOf(row) === today
                  ? intl.formatMessage({ id: 'dashboard.today' })
                  : intl.formatDate(`${dayOf(row)}T12:00:00`, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {row.patient_given} {row.patient_family} — {row.title}
                </span>
                <span className="block truncate text-xs text-secondary">
                  {row.treatment_name}
                  {row.location !== null && row.location !== '' ? ` — ${row.location}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

export function UnreadConversationsCard(): ReactElement {
  const threads = useQuery(threadsQuery('staff'));
  const unread = (threads.data ?? []).filter((row) => row.unread > 0).slice(0, 4);

  return (
    <CardShell
      icon={<IconMessages size={17} />}
      titleId="dashboard.unreadTitle"
      to="/messages"
      linkId="home.openMessages"
    >
      {threads.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : threads.isError ? (
        <ErrorState onRetry={() => void threads.refetch()} />
      ) : unread.length === 0 ? (
        <p className="py-1 text-sm text-muted">
          <FormattedMessage id="dashboard.noUnread" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {unread.map((row) => (
            <li key={row.treatment_id}>
              <Link
                to="/messages/$treatmentId"
                params={{ treatmentId: row.treatment_id }}
                className="block py-2.5 transition-colors hover:bg-surface-sunken"
              >
                <span className="block truncate text-sm font-medium text-ink">
                  {row.patient_given} {row.patient_family} — {row.treatment_name}
                </span>
                {row.last_preview !== null ? (
                  <span className="block truncate text-sm text-secondary">{row.last_preview}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}
