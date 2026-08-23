import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, Card, CardHeader, ErrorState, Skeleton, StatusChip } from '@mio/ui';

/**
 * PP2: the patient's value series - latest three entries per series with
 * the derived trend label, and a per-series view with the 12-month
 * chart, the full record table (provenance always rendered) and the
 * on-behalf "New value" entry. Trend labels are display derivation and
 * deliberately NOT color-graded: whether "rising" is good or bad depends
 * on the measure, and that judgement is not this card's to make.
 */

interface EntryRow {
  id: string;
  value: string | number | null;
  measured_at: string;
  note: string;
  on_behalf_of_patient: boolean;
  entered_given: string | null;
  entered_family: string | null;
  patient_given?: string | null;
  patient_family?: string | null;
}

interface SeriesRow {
  id: string;
  key: string;
  name: string;
  unit: string;
  kind: string;
  latest: EntryRow[];
  trend: 'rising' | 'falling' | 'stable' | null;
}

const TREND_GLYPH = { rising: '↑', falling: '↓', stable: '→' } as const;

const inputClass = 'rounded-inner border border-border bg-surface px-2.5 py-1.5 text-sm text-ink';

function SeriesChart({ entries, unit }: { entries: EntryRow[]; unit: string }): ReactElement {
  const intl = useIntl();
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const points = entries
    .filter(
      (entry) => entry.value !== null && entry.measured_at >= yearAgo.toISOString().slice(0, 10),
    )
    .map((entry) => ({ date: entry.measured_at, value: Number(entry.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        <FormattedMessage id="values.chartEmpty" />
      </p>
    );
  }
  const w = 560;
  const h = 160;
  const pad = 30;
  const t0 = new Date(points[0]!.date).getTime();
  const t1 = new Date(points[points.length - 1]!.date).getTime();
  const values = points.map((point) => point.value);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const spanV = vMax - vMin || 1;
  const x = (date: string): number =>
    pad + ((new Date(date).getTime() - t0) / Math.max(t1 - t0, 1)) * (w - pad * 2);
  const y = (value: number): number => h - pad - ((value - vMin) / spanV) * (h - pad * 2);
  const path = points.map((point) => `${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={intl.formatMessage({ id: 'values.chartLabel' }, { count: points.length, unit })}
      className="w-full"
    >
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--color-border, #ddd)" />
      <text
        x={pad - 6}
        y={y(vMax) + 4}
        textAnchor="end"
        fontSize="10"
        fill="currentColor"
        opacity="0.6"
      >
        {vMax}
      </text>
      <text
        x={pad - 6}
        y={y(vMin) + 4}
        textAnchor="end"
        fontSize="10"
        fill="currentColor"
        opacity="0.6"
      >
        {vMin}
      </text>
      <polyline
        points={path.join(' ')}
        fill="none"
        stroke="#1f7a72"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {points.map((point) => (
        <circle
          key={point.date + String(point.value)}
          cx={x(point.date)}
          cy={y(point.value)}
          r="3"
          fill="#1f7a72"
        />
      ))}
    </svg>
  );
}

function provenanceOf(intl: ReturnType<typeof useIntl>, entry: EntryRow): string {
  if (entry.on_behalf_of_patient && entry.entered_given !== null) {
    return intl.formatMessage(
      { id: 'values.onBehalf' },
      { name: `${entry.entered_given} ${entry.entered_family ?? ''}`.trim() },
    );
  }
  return intl.formatMessage({ id: 'values.byPatient' });
}

function SeriesDialog({
  patientId,
  series,
  onClose,
}: {
  patientId: string;
  series: SeriesRow;
  onClose: () => void;
}): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [measuredAt, setMeasuredAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  const detail = useQuery({
    queryKey: ['values', patientId, series.id],
    queryFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/values/${series.id}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`series: ${response.status}`);
      return (await response.json()) as { entries: EntryRow[] };
    },
    retry: false,
  });
  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/values/${series.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          value: Number(value.replace(',', '.')),
          measuredAt,
          ...(note.trim() !== '' ? { note } : {}),
        }),
      });
      if (!response.ok) throw new Error(`create: ${response.status}`);
    },
    onSuccess: async () => {
      setValue('');
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['values', patientId] });
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="series-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-card bg-surface shadow-raised">
        <header className="flex items-baseline justify-between border-b border-hairline px-6 py-4">
          <h2 id="series-title" className="font-display text-lg italic text-ink">
            {series.name} · {series.unit}
          </h2>
          <Button variant="quiet" size="sm" onPress={onClose}>
            <FormattedMessage id="common.close" />
          </Button>
        </header>
        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          {detail.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.isError ? (
            <ErrorState onRetry={() => void detail.refetch()} />
          ) : (
            <>
              <SeriesChart entries={detail.data.entries} unit={series.unit} />
              <form
                className="flex flex-wrap items-end gap-2 rounded-inner bg-surface-sunken p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (value.trim() !== '') create.mutate();
                }}
              >
                <label className="block text-xs font-medium text-secondary">
                  <FormattedMessage id="values.newValue" />
                  <input
                    className={`${inputClass} mt-1 block w-28`}
                    inputMode="decimal"
                    value={value}
                    onChange={(event) => setValue(event.currentTarget.value)}
                  />
                </label>
                <label className="block text-xs font-medium text-secondary">
                  <FormattedMessage id="values.measuredAt" />
                  <input
                    type="date"
                    className={`${inputClass} mt-1 block`}
                    value={measuredAt}
                    onChange={(event) => setMeasuredAt(event.currentTarget.value)}
                  />
                </label>
                <label className="block min-w-40 flex-1 text-xs font-medium text-secondary">
                  <FormattedMessage id="values.note" />
                  <input
                    className={`${inputClass} mt-1 block w-full`}
                    value={note}
                    onChange={(event) => setNote(event.currentTarget.value)}
                  />
                </label>
                <Button
                  size="sm"
                  type="submit"
                  isDisabled={value.trim() === '' || create.isPending}
                >
                  <FormattedMessage id="values.add" />
                </Button>
                <p className="w-full text-xs text-muted">
                  <FormattedMessage id="values.onBehalfNote" />
                </p>
              </form>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 pr-3 font-medium">
                        <FormattedMessage id="values.measuredAt" />
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        <FormattedMessage id="values.value" />
                      </th>
                      <th className="py-2 pr-3 font-medium">
                        <FormattedMessage id="values.enteredBy" />
                      </th>
                      <th className="py-2 font-medium">
                        <FormattedMessage id="values.note" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-hairline last:border-b-0">
                        <td className="py-2 pr-3 text-ink">
                          {intl.formatDate(entry.measured_at, { dateStyle: 'medium' })}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-ink">
                          {entry.value === null ? '—' : `${entry.value} ${series.unit}`}
                        </td>
                        <td className="py-2 pr-3 text-secondary">{provenanceOf(intl, entry)}</td>
                        <td className="py-2 text-secondary">{entry.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ValuesCard({ patientId }: { patientId: string }): ReactElement {
  const intl = useIntl();
  const [openSeries, setOpenSeries] = useState<SeriesRow | null>(null);
  const summary = useQuery({
    queryKey: ['values', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/patients/${patientId}/values`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`values: ${response.status}`);
      return (await response.json()) as SeriesRow[];
    },
    retry: false,
  });

  if (summary.isPending) return <Skeleton className="h-28 w-full" />;
  if (summary.isError) return <ErrorState onRetry={() => void summary.refetch()} />;

  return (
    <Card>
      <CardHeader title={<FormattedMessage id="values.title" />} />
      {summary.data.length === 0 ? (
        <p className="text-sm text-secondary">
          <FormattedMessage id="values.empty" />
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {summary.data.map((series) => (
            <li key={series.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">
                  {series.name}
                  {series.trend !== null ? (
                    <span className="ml-2">
                      <StatusChip tone="neutral">
                        {`${TREND_GLYPH[series.trend]} ${intl.formatMessage({ id: `values.trend.${series.trend}` })}`}
                      </StatusChip>
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-secondary">
                  {series.latest.length === 0 ? (
                    <FormattedMessage id="values.noEntries" />
                  ) : (
                    series.latest
                      .map(
                        (entry) =>
                          `${entry.value ?? '—'} ${series.unit} · ${intl.formatDate(entry.measured_at, { dateStyle: 'medium' })}`,
                      )
                      .join('   ')
                  )}
                </span>
              </span>
              <Button variant="quiet" size="sm" onPress={() => setOpenSeries(series)}>
                <FormattedMessage id="roster.open" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {openSeries !== null ? (
        <SeriesDialog
          patientId={patientId}
          series={openSeries}
          onClose={() => setOpenSeries(null)}
        />
      ) : null}
    </Card>
  );
}
