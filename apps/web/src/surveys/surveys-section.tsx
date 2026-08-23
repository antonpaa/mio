import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, Skeleton, StatusChip } from '@mio/ui';
import { AssignSurveyDialog } from './assign-survey-dialog.js';

/** T1: the treatment's attached surveys with their schedules (PP1's
 * "assigned surveys w/ schedules" slice). */

interface AssignmentRow {
  id: string;
  survey_id: string;
  name: string;
  kind: string;
  licensed_source: string | null;
  language: string | null;
  pinned_version: number | null;
  newest_version: number | null;
  schedule: {
    anchorDate: string;
    segments: { freq: string; interval?: number; count?: number }[];
    answerWindowDays: number | null;
    reminderAfterDays: number | null;
  } | null;
  next_due: string | null;
}

export function SurveysSection({ treatmentId }: { treatmentId: string }): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const assignments = useQuery({
    queryKey: ['treatment-surveys', treatmentId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/treatments/${treatmentId}/surveys`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`assignments: ${response.status}`);
      return (await response.json()) as AssignmentRow[];
    },
    retry: false,
  });

  return (
    <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          <FormattedMessage id="assign.sectionTitle" />
        </h2>
        <Button variant="quiet" size="sm" onPress={() => setDialogOpen(true)}>
          <FormattedMessage id="assign.add" />
        </Button>
      </div>

      {assignments.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : assignments.isError ? (
        <p className="py-2 text-sm text-muted">
          <FormattedMessage id="assign.loadFailed" />
        </p>
      ) : assignments.data.length === 0 ? (
        <p className="py-2 text-sm text-muted">
          <FormattedMessage id="assign.empty" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {assignments.data.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {row.name}
                  {row.licensed_source ? (
                    <span
                      className="ml-1.5 text-xs font-normal text-muted"
                      title={row.licensed_source}
                    >
                      <FormattedMessage id="assign.licensed" />
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-secondary">
                  {row.schedule
                    ? intl.formatMessage(
                        { id: 'assign.scheduleSummary' },
                        {
                          date: intl.formatDate(`${row.schedule.anchorDate}T12:00:00`, {
                            day: 'numeric',
                            month: 'short',
                          }),
                          window: row.schedule.answerWindowDays ?? '—',
                        },
                      )
                    : row.next_due
                      ? intl.formatMessage(
                          { id: 'assign.nextDue' },
                          {
                            date: intl.formatDate(`${row.next_due}T12:00:00`, {
                              day: 'numeric',
                              month: 'short',
                            }),
                          },
                        )
                      : intl.formatMessage({ id: 'assign.noSchedule' })}
                </p>
              </div>
              <StatusChip tone="neutral">
                {row.pinned_version !== null
                  ? `v${row.pinned_version}`
                  : intl.formatMessage(
                      { id: 'assign.newestVersion' },
                      { version: row.newest_version ?? 1 },
                    )}
              </StatusChip>
              <StatusChip tone="neutral">
                {row.language === null
                  ? intl.formatMessage({ id: 'assign.patientsChoice' })
                  : row.language.toUpperCase()}
              </StatusChip>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen ? (
        <AssignSurveyDialog
          treatmentId={treatmentId}
          onClose={() => setDialogOpen(false)}
          onAssigned={() => {
            void queryClient.invalidateQueries({ queryKey: ['treatment-surveys', treatmentId] });
            void queryClient.invalidateQueries({ queryKey: ['activities', treatmentId] });
          }}
        />
      ) : null}
    </section>
  );
}
