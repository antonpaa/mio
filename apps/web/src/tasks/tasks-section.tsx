import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, Skeleton, StatusChip } from '@mio/ui';
import { useSession } from '../session/session.js';
import { TaskDialog } from './task-dialog.js';
import { type TaskRow } from './task-model.js';

/** T1: this treatment's work items, the linked-order-task slice. */
export function TasksSection({ treatmentId }: { treatmentId: string }): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const me = session.account?.id ?? '';
  const tasks = useQuery({
    queryKey: ['treatment-tasks', treatmentId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/treatments/${treatmentId}/tasks`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`tasks: ${response.status}`);
      return (await response.json()) as TaskRow[];
    },
    retry: false,
  });
  const act = useMutation({
    mutationFn: async (input: { id: string; verb: 'claim' | 'complete' }) => {
      const response = await fetch(`/api/staff/tasks/${input.id}/${input.verb}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      if (!response.ok) throw new Error(`${input.verb}: ${response.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treatment-tasks', treatmentId] }),
  });

  return (
    <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          <FormattedMessage id="tasks.title" />
        </h2>
        <Button variant="quiet" size="sm" onPress={() => setDialogOpen(true)}>
          <FormattedMessage id="tasks.add" />
        </Button>
      </div>

      {tasks.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : tasks.isError ? (
        <p className="py-2 text-sm text-muted">
          <FormattedMessage id="tasks.loadFailed" />
        </p>
      ) : tasks.data.length === 0 ? (
        <p className="py-2 text-sm text-muted">
          <FormattedMessage id="tasks.emptyForTreatment" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {tasks.data.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm font-medium ${
                    task.status === 'completed' ? 'text-muted line-through' : 'text-ink'
                  }`}
                >
                  {task.title}
                </p>
                <p className="truncate text-xs text-secondary">
                  {task.due_date !== null
                    ? intl.formatDate(`${task.due_date}T12:00:00`, {
                        day: 'numeric',
                        month: 'short',
                      })
                    : null}
                  {task.due_date !== null && task.assignee_id !== null ? ' — ' : ''}
                  {task.assignee_id !== null
                    ? `${task.assignee_given ?? ''} ${task.assignee_family ?? ''}`
                    : null}
                </p>
              </div>
              {task.status === 'completed' ? (
                <StatusChip tone="neutral">
                  {intl.formatMessage({ id: 'activity.status.completed' })}
                </StatusChip>
              ) : task.assignee_id === null ? (
                <>
                  <StatusChip tone="amber">
                    {intl.formatMessage({ id: 'tasks.queueChip' })}
                  </StatusChip>
                  <Button
                    variant="quiet"
                    size="sm"
                    isDisabled={act.isPending}
                    onPress={() => void act.mutate({ id: task.id, verb: 'claim' })}
                  >
                    <FormattedMessage id="tasks.claim" />
                  </Button>
                </>
              ) : task.assignee_id === me || task.viewer_is_lead === true ? (
                <Button
                  variant="quiet"
                  size="sm"
                  isDisabled={act.isPending}
                  onPress={() => void act.mutate({ id: task.id, verb: 'complete' })}
                >
                  <FormattedMessage id="tasks.complete" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {dialogOpen ? (
        <TaskDialog
          treatmentId={treatmentId}
          onClose={() => setDialogOpen(false)}
          onCreated={() =>
            void queryClient.invalidateQueries({ queryKey: ['treatment-tasks', treatmentId] })
          }
        />
      ) : null}
    </section>
  );
}
