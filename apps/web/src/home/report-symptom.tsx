import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, IconSymptoms } from '@mio/ui';
import { useLocaleControls } from '../app/locale-context.js';

/**
 * X7: the patient-side "Report a symptom" flow the design's data
 * promised (source self_report). The patient states the fact - symptom,
 * how strong, an optional note. Grading against the program stays the
 * clinician's; the register shows this entry exactly like every other
 * observation, with the patient's own provenance.
 */

interface TaxonomyRow {
  id: string;
  code: string;
  label_en: string;
  label_fi: string;
  label_sv: string;
}

interface OwnRow extends TaxonomyRow {
  severity: 'mild' | 'moderate' | 'severe';
  observed_at: string;
  source: string;
}

const GRADES = ['mild', 'moderate', 'severe'] as const;

function labelOf(row: TaxonomyRow, locale: string): string {
  if (locale === 'fi') return row.label_fi;
  if (locale === 'sv') return row.label_sv;
  return row.label_en;
}

export function ReportSymptom(): ReactElement {
  const intl = useIntl();
  const { locale } = useLocaleControls();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [symptomId, setSymptomId] = useState('');
  const [severity, setSeverity] = useState<(typeof GRADES)[number] | ''>('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const payload = useQuery({
    queryKey: ['patient-symptoms'],
    queryFn: async (): Promise<{ taxonomy: TaxonomyRow[]; own: OwnRow[] }> => {
      const response = await fetch('/api/patient/symptoms', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`symptoms: ${response.status}`);
      return (await response.json()) as { taxonomy: TaxonomyRow[]; own: OwnRow[] };
    },
    enabled: open,
    retry: false,
  });

  const report = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/patient/symptoms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ symptomId, severity, ...(note.trim() ? { note } : {}) }),
      });
      if (!response.ok) throw new Error(`report: ${response.status}`);
    },
    onSuccess: () => {
      setSent(true);
      setSymptomId('');
      setSeverity('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['patient-symptoms'] });
    },
  });

  const close = (): void => {
    setOpen(false);
    setSent(false);
  };

  return (
    <>
      <Button size="sm" variant="quiet" onPress={() => setOpen(true)}>
        <span className="flex items-center gap-1.5">
          <IconSymptoms size={16} />
          <FormattedMessage id="selfreport.action" />
        </span>
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="selfreport-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
            <h2 id="selfreport-title" className="font-display text-lg italic text-ink">
              <FormattedMessage id="selfreport.title" />
            </h2>
            {sent ? (
              <>
                <p className="mt-3 text-sm text-secondary">
                  <FormattedMessage id="selfreport.thanks" />
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
                  <FormattedMessage id="selfreport.why" />
                </p>
                <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
                  <FormattedMessage id="selfreport.symptom" />
                  <select
                    className="mt-1 block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm font-normal text-ink"
                    value={symptomId}
                    onChange={(event) => setSymptomId(event.currentTarget.value)}
                  >
                    <option value="">{intl.formatMessage({ id: 'selfreport.pickSymptom' })}</option>
                    {(payload.data?.taxonomy ?? []).map((row) => (
                      <option key={row.id} value={row.id}>
                        {labelOf(row, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="mt-4">
                  <legend className="text-sm font-medium text-ink-strong-secondary">
                    <FormattedMessage id="selfreport.howStrong" />
                  </legend>
                  <div className="mt-1.5 flex gap-1.5">
                    {GRADES.map((grade) => (
                      <button
                        key={grade}
                        type="button"
                        aria-pressed={severity === grade}
                        onClick={() => setSeverity(grade)}
                        className={`rounded-pill border px-3.5 py-1.5 text-sm transition-colors ${
                          severity === grade
                            ? 'border-teal bg-teal-tint font-medium text-teal'
                            : 'border-border bg-surface text-secondary hover:bg-surface-sunken'
                        }`}
                      >
                        {intl.formatMessage({ id: `symptoms.grade.${grade}` })}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
                  <FormattedMessage id="selfreport.note" />
                  <textarea
                    className="mt-1 block w-full rounded-inner border border-border bg-surface px-3 py-2 text-sm font-normal text-ink"
                    rows={2}
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.currentTarget.value)}
                  />
                </label>
                {(payload.data?.own ?? []).length > 0 ? (
                  <div className="mt-4">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                      <FormattedMessage id="selfreport.recent" />
                    </h3>
                    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-secondary">
                      {(payload.data?.own ?? []).slice(0, 3).map((row) => (
                        <li key={`${row.id}-${row.observed_at}`}>
                          {labelOf(row, locale)} —{' '}
                          {intl.formatMessage({ id: `symptoms.grade.${row.severity}` })} —{' '}
                          {intl.formatDate(row.observed_at, { day: 'numeric', month: 'short' })}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                  <Button size="sm" variant="quiet" onPress={close}>
                    <FormattedMessage id="common.cancel" />
                  </Button>
                  <Button
                    size="sm"
                    onPress={() => report.mutate()}
                    isDisabled={symptomId === '' || severity === '' || report.isPending}
                  >
                    <FormattedMessage id="selfreport.send" />
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
