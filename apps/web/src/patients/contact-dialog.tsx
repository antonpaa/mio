import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage } from 'react-intl';
import { Button, useModalFocus } from '@mio/ui';

/**
 * PP5 assisted edit: the care team corrects contact details the patient
 * gave them in clinic or by phone. The field set is exactly what the
 * patient can change themselves in P8 - this is help, not
 * administration - and every save is audited as an assisted change.
 */

export interface ContactDetails {
  phone: string | null;
  address: Record<string, string> | null;
  locale: string;
}

const inputClass =
  'mt-1 w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm text-ink';

export function EditContactButton({
  patientId,
  current,
}: {
  patientId: string;
  current: ContactDetails;
}): ReactElement {
  const queryClient = useQueryClient();
  const modalRef = useModalFocus<HTMLDivElement>();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(current.phone ?? '');
  const [street, setStreet] = useState(current.address?.['street'] ?? '');
  const [postalCode, setPostalCode] = useState(current.address?.['postalCode'] ?? '');
  const [city, setCity] = useState(current.address?.['city'] ?? '');
  const [locale, setLocale] = useState(current.locale);

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          phone,
          address: { street, postalCode, city },
          locale,
        }),
      });
      if (!response.ok) throw new Error(`contact: ${response.status}`);
    },
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });

  return (
    <>
      <Button size="sm" variant="quiet" onPress={() => setOpen(true)}>
        <FormattedMessage id="pp5.editContact" />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-contact-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
            <h2 id="edit-contact-title" className="font-display text-lg italic text-ink">
              <FormattedMessage id="pp5.editContact" />
            </h2>
            <p className="mt-1 text-xs text-muted">
              <FormattedMessage id="pp5.assistedNote" />
            </p>
            <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="pp5.phone" />
              <input
                className={inputClass}
                value={phone}
                onChange={(event) => setPhone(event.currentTarget.value)}
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="pp5.street" />
              <input
                className={inputClass}
                value={street}
                onChange={(event) => setStreet(event.currentTarget.value)}
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-ink-strong-secondary">
                <FormattedMessage id="pp5.postalCode" />
                <input
                  className={inputClass}
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.currentTarget.value)}
                />
              </label>
              <label className="block text-sm font-medium text-ink-strong-secondary">
                <FormattedMessage id="pp5.city" />
                <input
                  className={inputClass}
                  value={city}
                  onChange={(event) => setCity(event.currentTarget.value)}
                />
              </label>
            </div>
            <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="admin.field.locale" />
              <select
                className={inputClass}
                value={locale}
                onChange={(event) => setLocale(event.currentTarget.value)}
              >
                {(['fi', 'sv', 'en'] as const).map((code) => (
                  <option key={code} value={code}>
                    {code.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            {save.isError ? (
              <p className="mt-3 text-sm text-red">
                <FormattedMessage id="pp5.saveFailed" />
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="quiet" onPress={() => setOpen(false)}>
                <FormattedMessage id="common.cancel" />
              </Button>
              <Button isDisabled={save.isPending} onPress={() => void save.mutate()}>
                <FormattedMessage id="pp5.save" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
