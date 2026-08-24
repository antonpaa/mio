import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, useModalFocus } from '@mio/ui';

/**
 * WP-29: recording a death is a care decision with total consequences -
 * sign-in closes, every outbound automation stops, the record stays.
 * The dialog says exactly that before asking for the date, and the
 * server writes both audit events either way.
 */

export function MarkDeceasedButton({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const mark = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/deceased`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ date }),
      });
      if (!response.ok) throw new Error(`deceased: ${response.status}`);
    },
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });

  return (
    <>
      <Button size="sm" variant="quiet" onPress={() => setOpen(true)}>
        <FormattedMessage id="pp.markDeceased" />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deceased-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
            <h2 id="deceased-title" className="font-display text-lg italic text-ink">
              {intl.formatMessage({ id: 'pp.deceasedTitle' }, { name: patientName })}
            </h2>
            <p className="mt-1 text-xs text-muted">
              <FormattedMessage id="pp.deceasedWhy" />
            </p>
            <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="pp.deceasedDate" />
              <input
                type="date"
                className="mt-1 block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm font-normal text-ink"
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDate(event.currentTarget.value)}
              />
            </label>
            {mark.isError ? (
              <p className="mt-2 text-sm text-red" role="alert">
                <FormattedMessage id="pp.deceasedFailed" />
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="quiet" onPress={() => setOpen(false)}>
                <FormattedMessage id="common.cancel" />
              </Button>
              <Button size="sm" onPress={() => mark.mutate()} isDisabled={!date || mark.isPending}>
                <FormattedMessage id="pp.deceasedConfirm" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
