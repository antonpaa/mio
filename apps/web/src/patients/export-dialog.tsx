import { useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, useModalFocus } from '@mio/ui';

/**
 * PP5: the clinician-side patient data export. It will not move without
 * a recorded reason - the server refuses (400) and both the request and
 * the download land in the audit log with the reason attached, which is
 * exactly what the patient's own access history will show.
 */

export function ExportDataButton({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);

  const exportData = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error(`export: ${response.status}`);
      return (await response.json()) as object;
    },
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mio-export-${patientId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDone(true);
    },
  });

  const close = (): void => {
    setOpen(false);
    setReason('');
    setDone(false);
    exportData.reset();
  };

  return (
    <>
      <Button size="sm" variant="quiet" onPress={() => setOpen(true)}>
        <FormattedMessage id="pp.export" />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
            <h2 id="export-title" className="font-display text-lg italic text-ink">
              {intl.formatMessage({ id: 'pp.exportTitle' }, { name: patientName })}
            </h2>
            {done ? (
              <>
                <p className="mt-3 text-sm text-secondary">
                  <FormattedMessage id="pp.exportDone" />
                </p>
                <div className="mt-5 flex justify-end">
                  <Button size="sm" onPress={close}>
                    <FormattedMessage id="common.close" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted">
                  <FormattedMessage id="pp.exportWhy" />
                </p>
                <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
                  <FormattedMessage id="pp.exportReason" />
                  <textarea
                    className="mt-1 block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm font-normal text-ink"
                    rows={2}
                    maxLength={300}
                    value={reason}
                    onChange={(event) => setReason(event.currentTarget.value)}
                  />
                </label>
                {exportData.isError ? (
                  <p className="mt-2 text-sm text-red" role="alert">
                    <FormattedMessage id="pp.exportFailed" />
                  </p>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                  <Button size="sm" variant="quiet" onPress={close}>
                    <FormattedMessage id="common.cancel" />
                  </Button>
                  <Button
                    size="sm"
                    onPress={() => exportData.mutate()}
                    isDisabled={reason.trim() === '' || exportData.isPending}
                  >
                    <FormattedMessage id="pp.exportDownload" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
