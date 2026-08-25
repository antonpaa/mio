import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Button,
  CountBadge,
  IconBell,
  IconCalendar,
  IconMessages,
  IconSurveys,
  Skeleton,
  StatusChip,
} from '@mio/ui';
import { useSession } from '../session/session.js';
import { useLocaleControls } from '../app/locale-context.js';
import { threadsQuery } from '../messages/model.js';
import { ReportSymptom } from './report-symptom.js';
import { NOTIFICATIONS_QUERY } from '../notifications/model.js';
import { useFillOccurrence } from '../surveys/start.js';

/**
 * P1/P7 (WP-26): the patient landing - Action needed, Messages, Updates,
 * Upcoming. Every widget rides a query an existing page already makes
 * (each one audited server-side); the landing composes, it does not add
 * disclosures.
 */

interface DueRow {
  activityId: string;
  responseId: string | null;
  dueDate: string;
  overdue: boolean;
  title: string;
  treatmentName: string;
}
interface SurveyList {
  due: DueRow[];
  drafts: { responseId: string; title: string }[];
}
interface CalendarRow {
  id: string;
  occurrence_date: string | null;
  scheduled_at: string | null;
  title: string;
  location: string | null;
  treatment_name: string;
}

function Widget({
  icon,
  titleId,
  to,
  linkId,
  badge,
  children,
}: {
  icon: ReactNode;
  titleId: string;
  to: string;
  /** The card's labeled action link, per the P1 canvas ("Open messages",
   * "All updates") - never a bare "Open". */
  linkId: string;
  badge?: number;
  children: ReactNode;
}): ReactElement {
  const intl = useIntl();
  return (
    <section
      aria-label={intl.formatMessage({ id: titleId })}
      className="flex flex-col rounded-card border border-black/5 bg-surface shadow-resting"
    >
      <header className="flex items-center gap-2 border-b border-hairline px-5 py-3">
        <span className="text-teal">{icon}</span>
        <h2 className="flex-1 text-sm font-semibold text-ink">
          <FormattedMessage id={titleId} />
        </h2>
        {badge !== undefined && badge > 0 ? (
          <CountBadge
            count={badge}
            label={intl.formatMessage({ id: 'home.unreadBadge' }, { count: badge })}
          />
        ) : null}
        <Link to={to} className="text-sm font-medium text-teal underline-offset-4 hover:underline">
          <FormattedMessage id={linkId} />
        </Link>
      </header>
      <div className="flex-1 px-5 py-3">{children}</div>
    </section>
  );
}

/** The canvas greets by the time of day; the date line sits under it. */
export function greetingIdForHour(hour: number): string {
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

function EmptyLine({ id }: { id: string }): ReactElement {
  return (
    <p className="py-1 text-sm text-muted">
      <FormattedMessage id={id} />
    </p>
  );
}

export function PatientHomePage(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const { locale } = useLocaleControls();
  const fill = useFillOccurrence();

  const surveys = useQuery({
    queryKey: ['patient-surveys'],
    queryFn: async (): Promise<SurveyList> => {
      const response = await fetch('/api/patient/surveys', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`surveys: ${response.status}`);
      return (await response.json()) as SurveyList;
    },
    retry: false,
  });
  const threads = useQuery(threadsQuery('patient'));
  const updates = useQuery(NOTIFICATIONS_QUERY);
  const calendar = useQuery({
    queryKey: ['calendar'],
    queryFn: async (): Promise<CalendarRow[]> => {
      const response = await fetch('/api/patient/calendar', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`calendar: ${response.status}`);
      return (await response.json()) as CalendarRow[];
    },
    retry: false,
  });

  const due = surveys.data?.due ?? [];
  const drafts = surveys.data?.drafts ?? [];
  const unreadThreads = (threads.data ?? []).filter((row) => row.unread > 0);
  const latestUpdates = (updates.data?.items ?? []).slice(0, 3);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (calendar.data ?? [])
    .filter((row) => (row.occurrence_date ?? row.scheduled_at ?? '').slice(0, 10) >= today)
    .slice(0, 3);

  const loading = surveys.isPending || threads.isPending || updates.isPending || calendar.isPending;
  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl italic text-ink">
            <FormattedMessage
              id={greetingIdForHour(new Date().getHours())}
              values={{ name: session.account?.givenName ?? '' }}
            />
          </h1>
          <p className="mt-1 text-sm text-secondary">
            {intl.formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {/* X7: the self-report entry point */}
        <ReportSymptom />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Widget
          icon={<IconSurveys size={17} />}
          titleId="home.actionNeeded"
          to="/surveys"
          linkId="home.allSurveys"
          badge={due.length + drafts.length}
        >
          {due.length === 0 && drafts.length === 0 ? (
            <EmptyLine id="home.nothingDue" />
          ) : (
            <ul className="divide-y divide-hairline">
              {due.slice(0, 3).map((row) => (
                <li key={row.activityId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{row.title}</span>
                    <span className="block text-xs text-secondary">
                      {row.treatmentName} —{' '}
                      {intl.formatDate(`${row.dueDate}T12:00:00`, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </span>
                  {row.overdue ? (
                    <StatusChip tone="amber">
                      {intl.formatMessage({ id: 'surveys.overdue' })}
                    </StatusChip>
                  ) : null}
                  <Button
                    size="sm"
                    isDisabled={fill.isPending}
                    onPress={() => void fill.mutate(row.activityId)}
                  >
                    <FormattedMessage
                      id={row.responseId !== null ? 'surveys.resume' : 'surveys.start'}
                    />
                  </Button>
                </li>
              ))}
              {drafts.slice(0, 2).map((row) => (
                <li key={row.responseId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {row.title}
                  </span>
                  <StatusChip tone="neutral">{intl.formatMessage({ id: 'home.draft' })}</StatusChip>
                </li>
              ))}
            </ul>
          )}
        </Widget>

        <Widget
          icon={<IconMessages size={17} />}
          titleId="home.messages"
          to="/messages"
          linkId="home.openMessages"
          badge={unreadThreads.reduce((sum, row) => sum + row.unread, 0)}
        >
          {unreadThreads.length === 0 ? (
            <EmptyLine id="home.noNewMessages" />
          ) : (
            <ul className="divide-y divide-hairline">
              {unreadThreads.slice(0, 3).map((row) => (
                <li key={row.treatment_id} className="py-2">
                  <Link
                    to="/messages/$treatmentId"
                    params={{ treatmentId: row.treatment_id }}
                    className="block"
                  >
                    <span className="block truncate text-sm font-medium text-ink">
                      {row.treatment_name}
                    </span>
                    {row.last_preview !== null ? (
                      <span className="block truncate text-sm text-secondary">
                        {row.last_preview}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Widget>

        <Widget
          icon={<IconBell size={17} />}
          titleId="home.updates"
          to="/notifications"
          linkId="home.allUpdates"
          badge={updates.data?.unread ?? 0}
        >
          {latestUpdates.length === 0 ? (
            <EmptyLine id="home.noUpdates" />
          ) : (
            <ul className="divide-y divide-hairline">
              {latestUpdates.map((item) => (
                <li key={item.id} className="py-2">
                  <span className="block text-sm text-ink">
                    {item.kind === 'message.new' ? (
                      <FormattedMessage
                        id="notifications.newMessage"
                        values={{ treatment: item.treatment_name ?? '' }}
                      />
                    ) : (
                      (item.body?.[locale] ?? item.body?.['en'] ?? '')
                    )}
                  </span>
                  <span className="block text-xs text-muted">
                    {intl.formatDate(item.created_at, { day: 'numeric', month: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Widget>

        <Widget
          icon={<IconCalendar size={17} />}
          titleId="home.upcoming"
          to="/calendar"
          linkId="home.openCalendar"
        >
          {upcoming.length === 0 ? (
            <EmptyLine id="home.noUpcoming" />
          ) : (
            <ul className="divide-y divide-hairline">
              {upcoming.map((row) => {
                const when = row.scheduled_at ?? `${row.occurrence_date ?? today}T12:00:00`;
                const detail = [
                  row.scheduled_at !== null
                    ? intl.formatTime(when, { hour: 'numeric', minute: '2-digit' })
                    : '',
                  row.location ?? '',
                ]
                  .filter((part) => part !== '')
                  .join(', ');
                return (
                  <li key={row.id} className="flex items-center gap-3 py-2">
                    {/* the canvas's date tile - decorative, the sr-only date
                        below keeps the row readable without it */}
                    <span
                      aria-hidden
                      className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-inner border border-amber-chip-border bg-amber-tint"
                    >
                      <span className="text-[9px] font-medium uppercase leading-none tracking-wide text-amber">
                        {intl.formatDate(when, { weekday: 'short' })}
                      </span>
                      <span className="mt-0.5 font-display text-lg leading-none text-teal">
                        {intl.formatDate(when, { day: 'numeric' })}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {row.title}
                      </span>
                      <span className="block truncate text-xs text-secondary">
                        <span className="sr-only">
                          {intl.formatDate(when, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                          {detail !== '' ? ', ' : ''}
                        </span>
                        {detail}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Widget>
      </div>
    </div>
  );
}
