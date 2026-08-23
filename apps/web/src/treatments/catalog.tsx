import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, ErrorState, Skeleton, StatusChip } from '@mio/ui';

interface TemplateRow {
  id: string;
  name: string;
  detail: string;
  version_id: string;
  version: number;
  state: 'draft' | 'published' | 'archived';
  in_use: number;
}
interface RosterRow {
  patientId: string;
  givenName: string;
  familyName: string;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

/** T2 slice: the template catalog with instantiate-for-patient. */
export function TreatmentCatalogPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => getJson<TemplateRow[]>('/api/staff/templates'),
  });
  const roster = useQuery({
    queryKey: ['roster'],
    queryFn: () => getJson<RosterRow[]>('/api/staff/patients'),
  });
  const [useFor, setUseFor] = useState<TemplateRow | null>(null);
  const [patientId, setPatientId] = useState('');

  const instantiate = useMutation({
    mutationFn: async (input: { templateVersionId: string; patientId: string }) => {
      const response = await fetch('/api/staff/treatments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(`instantiate: ${response.status}`);
      return (await response.json()) as { treatmentId: string };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['roster'] });
      await navigate({ to: '/treatments/$treatmentId', params: { treatmentId: data.treatmentId } });
    },
  });

  if (templates.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (templates.isError) return <ErrorState onRetry={() => void templates.refetch()} />;

  const stateTone = { draft: 'neutral', published: 'teal', archived: 'red' } as const;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="catalog.title" />
      </h1>
      <div className="overflow-x-auto rounded-card border border-black/5 bg-surface shadow-resting">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">
                <FormattedMessage id="catalog.template" />
              </th>
              <th className="px-3 py-3 font-medium">
                <FormattedMessage id="catalog.version" />
              </th>
              <th className="px-3 py-3 font-medium">
                <FormattedMessage id="catalog.inUse" />
              </th>
              <th className="px-3 py-3 font-medium">
                <span className="sr-only">
                  <FormattedMessage id="catalog.actions" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.data.map((template) => (
              <tr key={template.version_id} className="border-b border-hairline last:border-b-0">
                <td className="px-5 py-3">
                  <p className="font-medium text-ink">{template.name}</p>
                  <p className="text-xs text-secondary">{template.detail}</p>
                </td>
                <td className="px-3 py-3">
                  <span className="mr-2 text-xs text-muted">v{template.version}</span>
                  <StatusChip tone={stateTone[template.state]}>
                    {intl.formatMessage({ id: `catalog.state.${template.state}` })}
                  </StatusChip>
                </td>
                <td className="px-3 py-3 text-secondary">
                  <FormattedMessage id="catalog.patients" values={{ count: template.in_use }} />
                </td>
                <td className="px-3 py-3 text-right">
                  {template.state === 'published' ? (
                    <Button variant="quiet" size="sm" onPress={() => setUseFor(template)}>
                      <FormattedMessage id="catalog.useForPatient" />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {useFor !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="use-for-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setUseFor(null);
          }}
        >
          <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-raised">
            <h2 id="use-for-title" className="font-display text-lg italic text-ink">
              {useFor.name} — v{useFor.version}
            </h2>
            <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="catalog.choosePatient" />
              <select
                className="mt-1.5 w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm"
                value={patientId}
                onChange={(event) => setPatientId(event.currentTarget.value)}
              >
                <option value="">—</option>
                {(roster.data ?? []).map((row) => (
                  <option key={row.patientId} value={row.patientId}>
                    {row.givenName} {row.familyName}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              <FormattedMessage id="catalog.copyNote" />
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="quiet" onPress={() => setUseFor(null)}>
                <FormattedMessage id="common.cancel" />
              </Button>
              <Button
                isDisabled={patientId === '' || instantiate.isPending}
                onPress={() =>
                  void instantiate.mutate({ templateVersionId: useFor.version_id, patientId })
                }
              >
                <FormattedMessage id="catalog.instantiate" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
