import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, useModalFocus } from '@mio/ui';
import { type StaffOption, type TaskRow } from './task-model.js';

/** Hand a task to a named colleague on the treatment's team. */
export function AssignDialog({
  task,
  onClose,
  onAssigned,
}: {
  task: TaskRow;
  onClose: () => void;
  onAssigned: () => void;
}): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? '');
  const staff = useQuery({
    queryKey: ['treatment-staff', task.treatment_id],
    queryFn: async () => {
      const response = await fetch(`/api/staff/treatments/${task.treatment_id}/staff`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`staff: ${response.status}`);
      return (await response.json()) as StaffOption[];
    },
  });
  const assign = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/tasks/${task.id}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ assigneeId }),
      });
      if (!response.ok) throw new Error(`assign: ${response.status}`);
    },
    onSuccess: () => {
      onAssigned();
      onClose();
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div ref={modalRef} className="w-full max-w-sm rounded-card bg-surface p-6 shadow-raised">
        <h2 id="assign-dialog-title" className="font-display text-lg italic text-ink">
          <FormattedMessage id="tasks.assignDialogTitle" />
        </h2>
        <p className="mt-1 text-sm text-secondary">{task.title}</p>
        <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
          <FormattedMessage id="tasks.assignee" />
          <select
            className="mt-1.5 w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm text-ink"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.currentTarget.value)}
          >
            <option value="">—</option>
            {(staff.data ?? []).map((option) => (
              <option key={option.staff_id} value={option.staff_id}>
                {option.given_name} {option.family_name}
                {option.title ? ` — ${option.title}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.cancel" />
          </Button>
          <Button
            isDisabled={assigneeId === '' || assign.isPending}
            onPress={() => void assign.mutate()}
          >
            {intl.formatMessage({ id: 'tasks.assign' })}
          </Button>
        </div>
      </div>
    </div>
  );
}
