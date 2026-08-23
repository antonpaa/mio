import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button } from '@mio/ui';
import { type StaffOption } from './task-model.js';

const inputClass =
  'mt-1.5 w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm text-ink';

/** T1 "+ Add task": a work item on this treatment, assigned or queued. */
export function TaskDialog({
  treatmentId,
  onClose,
  onCreated,
}: {
  treatmentId: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const intl = useIntl();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const staff = useQuery({
    queryKey: ['treatment-staff', treatmentId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/treatments/${treatmentId}/staff`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`staff: ${response.status}`);
      return (await response.json()) as StaffOption[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/treatments/${treatmentId}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title,
          detail,
          ...(dueDate ? { dueDate } : {}),
          ...(assigneeId ? { assigneeId } : {}),
        }),
      });
      if (!response.ok) throw new Error(`create: ${response.status}`);
    },
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
        <h2 id="task-dialog-title" className="font-display text-lg italic text-ink">
          <FormattedMessage id="tasks.dialogTitle" />
        </h2>
        <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
          <FormattedMessage id="tasks.titleLabel" />
          <input
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
          <FormattedMessage id="tasks.detailLabel" />
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={detail}
            onChange={(event) => setDetail(event.currentTarget.value)}
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="tasks.due" />
            <input
              type="date"
              className={inputClass}
              value={dueDate}
              onChange={(event) => setDueDate(event.currentTarget.value)}
            />
          </label>
          <label className="block text-sm font-medium text-ink-strong-secondary">
            <FormattedMessage id="tasks.assignee" />
            <select
              className={inputClass}
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.currentTarget.value)}
            >
              <option value="">{intl.formatMessage({ id: 'tasks.teamQueueOption' })}</option>
              {(staff.data ?? []).map((option) => (
                <option key={option.staff_id} value={option.staff_id}>
                  {option.given_name} {option.family_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {create.isError ? (
          <p className="mt-3 text-sm text-red" role="alert">
            <FormattedMessage id="tasks.createFailed" />
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.cancel" />
          </Button>
          <Button
            isDisabled={title.trim() === '' || create.isPending}
            onPress={() => void create.mutate()}
          >
            <FormattedMessage id="tasks.create" />
          </Button>
        </div>
      </div>
    </div>
  );
}
