import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Avatar, Button, EmptyState, ErrorState, Skeleton, StatusChip } from '@mio/ui';
import { useSession } from '../session/session.js';
import { AssignDialog } from './assign-dialog.js';
import { BUCKET_ORDER, bucketOf, localToday, type TaskRow } from './task-model.js';

type Tab = 'mine' | 'queue' | 'team';

/** C5: the team worklist - My / Unclaimed / Whole team, grouped by due. */
export function TasksPage(): ReactElement {
  const intl = useIntl();
  const session = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('mine');
  const [assigning, setAssigning] = useState<TaskRow | null>(null);
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  if (tasks.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (tasks.isError) return <ErrorState onRetry={() => void tasks.refetch()} />;

  const today = localToday();
  const counts: Record<Tab, number> = {
    mine: tasks.data.filter((task) => task.assignee_id === me).length,
    queue: tasks.data.filter((task) => task.assignee_id === null).length,
    team: tasks.data.length,
  };
  const visible = tasks.data.filter((task) =>
    tab === 'mine' ? task.assignee_id === me : tab === 'queue' ? task.assignee_id === null : true,
  );
  const groups = new Map<string, TaskRow[]>();
  for (const task of visible) {
    const bucket = bucketOf(task.due_date, today);
    const list = groups.get(bucket);
    if (list) list.push(task);
    else groups.set(bucket, [task]);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="tasks.title" />
      </h1>

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label={intl.formatMessage({ id: 'tasks.title' })}
      >
        {(['mine', 'queue', 'team'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            onClick={() => setTab(option)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              tab === option
                ? 'border-teal bg-teal-tint font-medium text-teal'
                : 'border-border bg-surface text-secondary hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            {intl.formatMessage({ id: `tasks.tab.${option}` })} ({counts[option]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title={intl.formatMessage({ id: 'tasks.emptyTitle' })}>
          <FormattedMessage id="tasks.empty" />
        </EmptyState>
      ) : (
        BUCKET_ORDER.filter((bucket) => groups.has(bucket)).map((bucket) => (
          <section key={bucket} aria-label={intl.formatMessage({ id: `tasks.group.${bucket}` })}>
            <h2
              className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${
                bucket === 'overdue' ? 'text-red' : 'text-muted'
              }`}
            >
              <FormattedMessage id={`tasks.group.${bucket}`} />
            </h2>
            <ul className="overflow-hidden rounded-card border border-black/5 bg-surface shadow-resting">
              {(groups.get(bucket) ?? []).map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{task.title}</p>
                    <p className="truncate text-xs text-secondary">
                      {task.patient_given} {task.patient_family} — {task.treatment_name}
                      {task.due_date !== null
                        ? ` — ${intl.formatDate(`${task.due_date}T12:00:00`, { day: 'numeric', month: 'short' })}`
                        : ''}
                    </p>
                  </div>
                  {task.assignee_id === null ? (
                    <StatusChip tone="amber">
                      {intl.formatMessage({ id: 'tasks.queueChip' })}
                    </StatusChip>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-secondary">
                      <Avatar
                        initials={`${task.assignee_given?.[0] ?? ''}${task.assignee_family?.[0] ?? ''}`}
                      />
                      {task.assignee_given} {task.assignee_family}
                    </span>
                  )}
                  <div className="flex gap-1">
                    {task.assignee_id === null ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        isDisabled={act.isPending}
                        onPress={() => void act.mutate({ id: task.id, verb: 'claim' })}
                      >
                        <FormattedMessage id="tasks.claim" />
                      </Button>
                    ) : null}
                    <Button
                      variant="quiet"
                      size="sm"
                      isDisabled={act.isPending}
                      onPress={() => setAssigning(task)}
                    >
                      <FormattedMessage id="tasks.assign" />
                    </Button>
                    {task.assignee_id === me || session.account?.role === 'treatment_lead' ? (
                      <Button
                        size="sm"
                        isDisabled={act.isPending}
                        onPress={() => void act.mutate({ id: task.id, verb: 'complete' })}
                      >
                        <FormattedMessage id="tasks.complete" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {assigning !== null ? (
        <AssignDialog
          task={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={() => void queryClient.invalidateQueries({ queryKey: ['tasks'] })}
        />
      ) : null}
    </div>
  );
}
