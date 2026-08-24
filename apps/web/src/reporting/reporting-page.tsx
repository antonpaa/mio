import type { ReactElement, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormattedMessage, FormattedNumber, useIntl } from 'react-intl';
import { EmptyState, ErrorState, Skeleton, StatusChip } from '@mio/ui';

/**
 * A4 reporting, on the CLINICAL side (gate P8, decided 2026-08-24):
 * response rates and open alerts across the caller's own treatment
 * programmes. Everything shown is an aggregate the API computed inside
 * the caller's team scope - no patient identity reaches this screen,
 * which is exactly why administrators (who hold no clinical scope)
 * cannot see it at all.
 */

export interface ReportOverview {
  windowDays: number;
  surveys: {
    due: number;
    completed: number;
    ratePercent: number | null;
    deltaPoints: number | null;
  };
  alerts: {
    openNow: number;
    openHigh: number;
    oldestHighDays: number | null;
    medianAckHours: number | null;
  };
  programs: {
    program: string;
    patients: number;
    due: number;
    completed: number;
    ratePercent: number | null;
    openAlerts: number;
    openHigh: number;
    openModerate: number;
  }[];
}

const reportQuery = {
  queryKey: ['reporting'],
  queryFn: async (): Promise<ReportOverview> => {
    const response = await fetch('/api/staff/reporting', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`reporting: ${response.status}`);
    return (await response.json()) as ReportOverview;
  },
};

function StatCard({
  titleId,
  value,
  detail,
}: {
  titleId: string;
  value: ReactNode;
  detail: ReactNode;
}): ReactElement {
  return (
    <section
      aria-labelledby={`${titleId}-heading`}
      className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting"
    >
      <h2
        id={`${titleId}-heading`}
        className="text-xs font-medium uppercase tracking-wide text-muted"
      >
        <FormattedMessage id={titleId} />
      </h2>
      <p className="mt-2 font-display text-3xl text-ink">{value}</p>
      <p className="mt-1 text-xs text-secondary">{detail}</p>
    </section>
  );
}

export function ReportingPage(): ReactElement {
  const intl = useIntl();
  const report = useQuery(reportQuery);

  if (report.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (report.isError) return <ErrorState onRetry={() => void report.refetch()} />;

  const { surveys, alerts, programs } = report.data;
  const dash = <span aria-hidden="true">—</span>;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="nav.reporting" />
        </h1>
        <p className="mt-1 text-sm text-secondary">
          <FormattedMessage id="reporting.lede" />
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          titleId="reporting.responseRate"
          value={surveys.ratePercent === null ? dash : `${surveys.ratePercent}%`}
          detail={
            surveys.deltaPoints === null ? (
              <FormattedMessage id="reporting.noPrevious" />
            ) : (
              <FormattedMessage
                id="reporting.deltaPoints"
                values={{
                  delta: intl.formatNumber(surveys.deltaPoints, { signDisplay: 'exceptZero' }),
                }}
              />
            )
          }
        />
        <StatCard
          titleId="reporting.openAlerts"
          value={<FormattedNumber value={alerts.openNow} />}
          detail={
            alerts.openHigh > 0 ? (
              <FormattedMessage
                id="reporting.openAlertsDetail"
                values={{ high: alerts.openHigh, days: alerts.oldestHighDays ?? 0 }}
              />
            ) : (
              <FormattedMessage id="reporting.noHighOpen" />
            )
          }
        />
        <StatCard
          titleId="reporting.medianAck"
          value={
            alerts.medianAckHours === null ? (
              dash
            ) : (
              <FormattedMessage
                id="reporting.hoursValue"
                values={{ hours: intl.formatNumber(alerts.medianAckHours) }}
              />
            )
          }
          detail={<FormattedMessage id="reporting.medianAckDetail" />}
        />
      </div>

      {programs.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'reporting.empty' })}>
          <FormattedMessage id="reporting.emptyBody" />
        </EmptyState>
      ) : (
        <section
          aria-labelledby="reporting-programs"
          className="overflow-x-auto rounded-card border border-black/5 bg-surface shadow-resting"
        >
          <h2
            id="reporting-programs"
            className="border-b border-hairline px-5 py-3 text-sm font-semibold text-ink"
          >
            <FormattedMessage id="reporting.perProgram" />
          </h2>
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-5 py-3 font-medium">
                  <FormattedMessage id="reporting.colProgram" />
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  <FormattedMessage id="reporting.colPatients" />
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  <FormattedMessage id="reporting.colRate" />
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  <FormattedMessage id="reporting.colAlerts" />
                </th>
              </tr>
            </thead>
            <tbody>
              {programs.map((row) => (
                <tr key={row.program} className="border-b border-border/60 last:border-b-0">
                  <td className="px-5 py-2 text-ink">{row.program}</td>
                  <td className="px-3 py-2 text-right text-secondary">
                    <FormattedNumber value={row.patients} />
                  </td>
                  <td className="px-3 py-2 text-right text-secondary">
                    {row.ratePercent === null ? dash : `${row.ratePercent}%`}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {row.openAlerts === 0 ? (
                      <span className="text-secondary">0</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        {row.openHigh > 0 ? (
                          <StatusChip tone="red">
                            {intl.formatMessage({ id: 'reporting.highCount' }, { n: row.openHigh })}
                          </StatusChip>
                        ) : row.openModerate > 0 ? (
                          <StatusChip tone="amber">
                            {intl.formatMessage(
                              { id: 'reporting.moderateCount' },
                              { n: row.openModerate },
                            )}
                          </StatusChip>
                        ) : null}
                        <span className="text-secondary">
                          <FormattedNumber value={row.openAlerts} />
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
