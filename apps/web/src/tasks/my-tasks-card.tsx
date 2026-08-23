import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Link } from '@tanstack/react-router';
import { IconTasks, Skeleton, StatusChip } from '@mio/ui';
import { useSession } from '../session/session.js';
import { bucketOf, localToday, type TaskRow } from './task-model.js';

/** C1's tasks slice (WP-13): my next tasks + the team queue pressure.
 * The full dashboard arrives with WP-27. */
export function MyTasksCard(): ReactElement {
  const intl = useIntl();
  const session = useSession();
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

  const today = localToday();
  const mine = (tasks.data ?? []).filter((task) => task.assignee_id === me).slice(0, 5);
  const unclaimed = (tasks.data ?? []).filter((task) => task.assignee_id === null).length;

  return (
    <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="text-teal">
            <IconTasks size={16} />
          </span>
          <FormattedMessage id="tasks.myCard" />
        </h2>
        <Link to="/tasks" className="text-sm text-teal hover:text-teal-hover">
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
            <p className="mt-2 border-t border-hairline pt-2 text-xs text-secondary">
              <FormattedMessage id="tasks.unclaimedCount" values={{ count: unclaimed }} />
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
