import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, ConfirmDialog, EmptyState, Skeleton, StatusChip } from '@mio/ui';
import { ScheduleDialog } from './schedule-dialog.js';

/** T1 activities: what the treatment has planned, with human status. */

export interface ActivityRow {
  id: string;
  occurrence_date: string | null;
  title: string;
  kind: 'visit' | 'lab' | 'infusion' | 'survey' | 'other';
  location: string | null;
  scheduled_at: string | null;
  status: 'planned' | 'confirmed' | 'completed' | 'cancelled';
  schedule_id: string | null;
}

export const STATUS_TONE = {
  planned: 'neutral',
  confirmed: 'teal',
  completed: 'teal',
  cancelled: 'red',
} as const;

/** Client-side mirror of the server's ACTIVITY_STATUS_FLOW - buttons only,
 * the server still decides. */
const NEXT_STATUSES: Record<ActivityRow['status'], ActivityRow['status'][]> = {
  planned: ['confirmed', 'completed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function ActivityDate({ date }: { date: string | null }): ReactElement {
  const intl = useIntl();
  if (!date) return <span aria-hidden className="w-12" />;
  const noon = `${date}T12:00:00`;
  return (
    <div className="w-12 shrink-0 text-center">
      <p className="text-lg font-semibold leading-tight text-ink">
        {intl.formatDate(noon, { day: 'numeric' })}
      </p>
      <p className="text-xs uppercase tracking-wide text-muted">
        {intl.formatDate(noon, { month: 'short' })}
      </p>
    </div>
  );
}

export function ActivitiesSection({ treatmentId }: { treatmentId: string }): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<ActivityRow | null>(null);
  const activities = useQuery({
    queryKey: ['activities', treatmentId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/treatments/${treatmentId}/activities`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`activities: ${response.status}`);
      return (await response.json()) as ActivityRow[];
    },
    retry: false,
  });
  const changeStatus = useMutation({
    mutationFn: async (input: { id: string; to: string }) => {
      const response = await fetch(`/api/staff/activities/${input.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ to: input.to }),
      });
      if (!response.ok) throw new Error(`status: ${response.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activities', treatmentId] }),
  });

  return (
    <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          <FormattedMessage id="activities.title" />
        </h2>
        <Button variant="quiet" size="sm" onPress={() => setDialogOpen(true)}>
          <FormattedMessage id="activities.add" />
        </Button>
      </div>

      {activities.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : activities.isError ? (
        <p className="py-3 text-sm text-muted">
          <FormattedMessage id="activities.loadFailed" />
        </p>
      ) : activities.data.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'activities.emptyTitle' })}>
          <FormattedMessage id="activities.empty" />
        </EmptyState>
      ) : (
        <ul className="divide-y divide-hairline">
          {activities.data.map((activity) => (
            <li key={activity.id} className="flex items-center gap-4 py-2.5">
              <ActivityDate date={activity.occurrence_date} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {activity.title}
                  {activity.schedule_id !== null ? (
                    <span
                      className="ml-1.5 text-muted"
                      title={intl.formatMessage({ id: 'activities.recurring' })}
                    >
                      ↻
                      <span className="sr-only">
                        {intl.formatMessage({ id: 'activities.recurring' })}
                      </span>
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-secondary">
                  {intl.formatMessage({ id: `activity.kind.${activity.kind}` })}
                  {activity.scheduled_at !== null
                    ? ` · ${intl.formatTime(activity.scheduled_at, { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                  {activity.location ? ` · ${activity.location}` : ''}
                </p>
              </div>
              <StatusChip tone={STATUS_TONE[activity.status]}>
                {intl.formatMessage({ id: `activity.status.${activity.status}` })}
              </StatusChip>
              <div className="flex gap-1">
                {NEXT_STATUSES[activity.status].map((to) => (
                  <Button
                    key={to}
                    variant={to === 'cancelled' ? 'danger' : 'quiet'}
                    size="sm"
                    isDisabled={changeStatus.isPending}
                    onPress={() =>
                      to === 'cancelled'
                        ? setConfirmCancel(activity)
                        : void changeStatus.mutate({ id: activity.id, to })
                    }
                  >
                    {intl.formatMessage({ id: `activity.to.${to}` })}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen ? (
        <ScheduleDialog
          treatmentId={treatmentId}
          onClose={() => setDialogOpen(false)}
          onCreated={() =>
            void queryClient.invalidateQueries({ queryKey: ['activities', treatmentId] })
          }
        />
      ) : null}

      {confirmCancel !== null ? (
        <ConfirmDialog
          title={intl.formatMessage({ id: 'activity.cancelConfirmTitle' })}
          cancelLabel={intl.formatMessage({ id: 'confirm.keep' })}
          confirmLabel={intl.formatMessage({ id: 'activity.cancelConfirmAction' })}
          danger
          busy={changeStatus.isPending}
          onCancel={() => setConfirmCancel(null)}
          onConfirm={() => {
            changeStatus.mutate(
              { id: confirmCancel.id, to: 'cancelled' },
              { onSettled: () => setConfirmCancel(null) },
            );
          }}
        >
          <FormattedMessage
            id="activity.cancelConfirmBody"
            values={{ title: confirmCancel.title }}
          />
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
