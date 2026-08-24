import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  IconSymptoms,
  Skeleton,
  StatusChip,
  useModalFocus,
} from '@mio/ui';

/**
 * PP3: the symptom register - per-symptom latest grade, derived trend and
 * source with provenance, plus the on-behalf "Report a symptom" flow.
 * The grade is the reported FACT; whether it is expected or alarming in
 * this program is the rule engine's judgement (C7, WP-22), and this card
 * never pretends otherwise.
 */

interface RegisterRow {
  code: string;
  symptomId: string;
  labels: { en: string; fi: string; sv: string };
  latest: {
    severity: 'mild' | 'moderate' | 'severe';
    observed_at: string;
    source: 'survey' | 'self_report' | 'clinician';
    on_behalf_of_patient: boolean;
    entered_given: string | null;
    entered_family: string | null;
    detail: { regions?: string[]; note?: string };
  };
  trend: 'new' | 'worsening' | 'stable' | 'easing';
  count: number;
}

interface TaxonomyRow {
  id: string;
  code: string;
  label_en: string;
  label_fi: string;
  label_sv: string;
}

const GRADE_TONE = { mild: 'neutral', moderate: 'amber', severe: 'red' } as const;

const inputClass =
  'mt-1 block rounded-inner border border-border bg-surface px-2.5 py-1.5 text-sm text-ink';

export function SymptomsCard({ patientId }: { patientId: string }): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [symptomId, setSymptomId] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [note, setNote] = useState('');

  const register = useQuery({
    queryKey: ['symptoms', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/symptoms`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`symptoms: ${response.status}`);
      return (await response.json()) as { register: RegisterRow[]; taxonomy: TaxonomyRow[] };
    },
    retry: false,
  });
  const report = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/symptoms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          symptomId,
          severity,
          ...(note.trim() !== '' ? { note } : {}),
        }),
      });
      if (!response.ok) throw new Error(`report: ${response.status}`);
    },
    onSuccess: async () => {
      setReporting(false);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['symptoms', patientId] });
    },
  });

  if (register.isPending) return <Skeleton className="h-28 w-full" />;
  if (register.isError) return <ErrorState onRetry={() => void register.refetch()} />;

  const locale = intl.locale.startsWith('fi') ? 'fi' : intl.locale.startsWith('sv') ? 'sv' : 'en';
  const labelOf = (labels: RegisterRow['labels']): string => labels[locale] || labels.en;
  const taxonomyLabel = (row: TaxonomyRow): string =>
    locale === 'fi' ? row.label_fi : locale === 'sv' ? row.label_sv : row.label_en;

  const sourceOf = (row: RegisterRow): string => {
    if (row.latest.on_behalf_of_patient && row.latest.entered_given !== null) {
      return intl.formatMessage(
        { id: 'symptoms.source.onBehalf' },
        { name: `${row.latest.entered_given} ${row.latest.entered_family ?? ''}`.trim() },
      );
    }
    return intl.formatMessage({ id: `symptoms.source.${row.latest.source}` });
  };

  return (
    <Card>
      <CardHeader
        icon={<IconSymptoms size={17} />}
        title={<FormattedMessage id="symptoms.title" />}
        action={
          <Button size="sm" variant="quiet" onPress={() => setReporting(true)}>
            <FormattedMessage id="symptoms.report" />
          </Button>
        }
      />
      {register.data.register.length === 0 ? (
        <p className="text-sm text-secondary">
          <FormattedMessage id="symptoms.empty" />
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">
                  <FormattedMessage id="symptoms.symptom" />
                </th>
                <th className="py-2 pr-3 font-medium">
                  <FormattedMessage id="symptoms.latest" />
                </th>
                <th className="py-2 pr-3 font-medium">
                  <FormattedMessage id="symptoms.trend" />
                </th>
                <th className="py-2 pr-3 font-medium">
                  <FormattedMessage id="symptoms.sourceCol" />
                </th>
                <th className="py-2 font-medium">
                  <FormattedMessage id="symptoms.observedAt" />
                </th>
              </tr>
            </thead>
            <tbody>
              {register.data.register.map((row) => (
                <tr key={row.code} className="border-b border-hairline last:border-b-0">
                  <td className="py-2.5 pr-3 font-medium text-ink">
                    {labelOf(row.labels)}
                    {row.latest.detail.regions !== undefined ? (
                      <span className="block text-xs font-normal text-muted">
                        {row.latest.detail.regions
                          .map((region) => intl.formatMessage({ id: `bodymap.region.${region}` }))
                          .join(', ')}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    <StatusChip tone={GRADE_TONE[row.latest.severity]}>
                      {intl.formatMessage({ id: `symptoms.grade.${row.latest.severity}` })}
                    </StatusChip>
                  </td>
                  <td className="py-2.5 pr-3 text-secondary">
                    {intl.formatMessage({ id: `symptoms.trend.${row.trend}` })}
                  </td>
                  <td className="py-2.5 pr-3 text-secondary">{sourceOf(row)}</td>
                  <td className="py-2.5 text-secondary">
                    {intl.formatDate(row.latest.observed_at, { dateStyle: 'medium' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reporting ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-symptom-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setReporting(false);
          }}
        >
          <div ref={modalRef} className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
            <h2 id="report-symptom-title" className="font-display text-lg italic text-ink">
              <FormattedMessage id="symptoms.report" />
            </h2>
            <p className="mt-1 text-xs text-muted">
              <FormattedMessage id="symptoms.onBehalfNote" />
            </p>
            <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="symptoms.symptom" />
              <select
                className={`${inputClass} w-full`}
                value={symptomId}
                onChange={(event) => setSymptomId(event.currentTarget.value)}
              >
                <option value="" />
                {register.data.taxonomy.map((row) => (
                  <option key={row.id} value={row.id}>
                    {taxonomyLabel(row)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="symptoms.grade" />
              <select
                className={`${inputClass} w-full`}
                value={severity}
                onChange={(event) => setSeverity(event.currentTarget.value)}
              >
                {(['mild', 'moderate', 'severe'] as const).map((grade) => (
                  <option key={grade} value={grade}>
                    {intl.formatMessage({ id: `symptoms.grade.${grade}` })}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="values.note" />
              <input
                className={`${inputClass} w-full`}
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="quiet" onPress={() => setReporting(false)}>
                <FormattedMessage id="common.cancel" />
              </Button>
              <Button
                isDisabled={symptomId === '' || report.isPending}
                onPress={() => void report.mutate()}
              >
                <FormattedMessage id="symptoms.save" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
