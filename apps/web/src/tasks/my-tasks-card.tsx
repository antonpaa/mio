import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Link } from '@tanstack/react-router';
import { Button, IconTasks, Skeleton, StatusChip } from '@mio/ui';
import { useSession } from '../session/session.js';
import { bucketOf, localToday, type TaskRow } from './task-model.js';

/** C1's tasks slice (WP-13): my next tasks, and the team queue's next
 * unclaimed ones claimable right on the card (canvas). */
export function MyTasksCard(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const queryClient = useQueryClient();
  const me = session.account?.id ?? '';
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const response = await fetch('/api/staff/tasks', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`tasks: ${response.status}`);
      return (await response.json()) as TaskRow[];
    },
    retry: false,
  });
  const claim = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await fetch(`/api/staff/tasks/${taskId}/claim`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`claim: ${response.status}`);
      return response.json() as Promise<unknown>;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const today = localToday();
  const mine = (tasks.data ?? []).filter((task) => task.assignee_id === me).slice(0, 5);
  const queue = (tasks.data ?? []).filter((task) => task.assignee_id === null);
  const unclaimed = queue.length;

  return (
    <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg italic text-ink">
          <span className="text-teal">
            <IconTasks size={16} />
          </span>
          <FormattedMessage id="tasks.myCard" />
        </h2>
        <Link
          to="/tasks"
          className="text-sm font-medium text-teal underline-offset-4 hover:underline"
        >
          <FormattedMessage id="tasks.viewAll" />
        </Link>
      </div>
      {tasks.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : tasks.isError ? (
        <p className="py-2 text-sm text-muted">
          <FormattedMessage id="tasks.loadFailed" />
        </p>
      ) : (
        <>
          {mine.length === 0 ? (
            <p className="py-2 text-sm text-muted">
              <FormattedMessage id="tasks.noneAssigned" />
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {mine.map((task) => (
                <li key={task.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{task.title}</p>
                    <p className="truncate text-xs text-secondary">
                      {task.patient_given} {task.patient_family} — {task.treatment_name}
                    </p>
                  </div>
                  {task.due_date !== null ? (
                    <StatusChip
                      tone={bucketOf(task.due_date, today) === 'overdue' ? 'red' : 'neutral'}
                    >
                      {intl.formatDate(`${task.due_date}T12:00:00`, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </StatusChip>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {unclaimed > 0 ? (
            <div className="mt-2 border-t border-hairline pt-1">
              {/* the queue's next tasks claimable in place (canvas) - the
                  C5 page remains the full queue */}
              <ul className="divide-y divide-hairline">
                {queue.slice(0, 3).map((task) => (
                  <li key={task.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{task.title}</p>
                      <p className="truncate text-xs text-secondary">
                        {task.patient_given} {task.patient_family} — {task.treatment_name}
                      </p>
                    </div>
                    <StatusChip tone="neutral">
                      {intl.formatMessage({ id: 'tasks.queueChip' })}
                    </StatusChip>
                    <Button
                      size="sm"
                      variant="quiet"
                      isDisabled={claim.isPending}
                      onPress={() => claim.mutate(task.id)}
                    >
                      <FormattedMessage id="tasks.claim" />
                    </Button>
                  </li>
                ))}
              </ul>
              {unclaimed > 3 ? (
                <p className="pt-1 text-xs text-secondary">
                  <FormattedMessage id="tasks.unclaimedCount" values={{ count: unclaimed }} />
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
