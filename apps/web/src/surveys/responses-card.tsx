import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Card, CardHeader, ErrorState, SeverityChip, Skeleton, StatusChip } from '@mio/ui';

/**
 * PP4: the completed surveys list - each response color-coded by what
 * its submission raised (alert severity / triggers only / nothing), with
 * on-behalf provenance, opening the WHOLE response bound to its exact
 * version (C7).
 */

interface ResponseRow {
  id: string;
  locale: string;
  submitted_at: string;
  version: number;
  survey_name: string;
  behalf_given: string | null;
  behalf_family: string | null;
  alert_severity: 'low' | 'moderate' | 'high' | null;
  trigger_count: number;
}

export function ResponsesCard({ patientId }: { patientId: string }): ReactElement {
  const intl = useIntl();
  const responses = useQuery({
    queryKey: ['patient-responses', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/responses`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`responses: ${response.status}`);
      return (await response.json()) as ResponseRow[];
    },
    retry: false,
  });

  if (responses.isPending) return <Skeleton className="h-28 w-full" />;
  if (responses.isError) return <ErrorState onRetry={() => void responses.refetch()} />;

  return (
    <Card>
      <CardHeader title={<FormattedMessage id="pp4.title" />} />
      {responses.data.length === 0 ? (
        <p className="text-sm text-secondary">
          <FormattedMessage id="pp4.empty" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {responses.data.slice(0, 8).map((row) => (
            <li key={row.id}>
              <Link
                to="/responses/$responseId"
                params={{ responseId: row.id }}
                className="flex flex-wrap items-center gap-3 py-2.5 transition-colors hover:bg-surface-sunken"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {row.survey_name}
                    <span className="ml-1.5 text-xs font-normal text-muted">v{row.version}</span>
                  </span>
                  <span className="block text-xs text-secondary">
                    {intl.formatDate(row.submitted_at, { dateStyle: 'medium', timeStyle: 'short' })}
                    {row.behalf_given !== null
                      ? ` · ${intl.formatMessage(
                          { id: 'c7.onBehalf' },
                          { name: `${row.behalf_given} ${row.behalf_family ?? ''}`.trim() },
                        )}`
                      : ''}
                  </span>
                </span>
                {row.alert_severity !== null ? (
                  <SeverityChip
                    severity={row.alert_severity}
                    label={intl.formatMessage({ id: `severity.${row.alert_severity}` })}
                  />
                ) : row.trigger_count > 0 ? (
                  <StatusChip tone="neutral">
                    {intl.formatMessage({ id: 'pp4.triggers' }, { count: row.trigger_count })}
                  </StatusChip>
                ) : (
                  <StatusChip tone="teal">
                    {intl.formatMessage({ id: 'pp4.noTriggers' })}
                  </StatusChip>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
