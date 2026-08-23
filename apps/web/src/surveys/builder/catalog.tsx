import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, ErrorState, Skeleton, StatusChip } from '@mio/ui';

/**
 * B1: the survey catalog for clinicians - versions with states, usage,
 * per-language completeness ("SV* — 3 untranslated") and licensing
 * provenance (R11), so a validated instrument is distinguishable from a
 * house-built one.
 */

interface CatalogRow {
  id: string;
  name: string;
  kind: string;
  licensed_source: string | null;
  versions: { id: string; version: number; state: string }[] | null;
  in_use: number;
}

const STATE_TONE = { draft: 'neutral', published: 'teal', archived: 'red' } as const;

const inputClass =
  'mt-1.5 w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm text-ink';

export function SurveyCatalogPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('symptom');
  const [licensedSource, setLicensedSource] = useState('');

  const catalog = useQuery({
    queryKey: ['survey-catalog'],
    queryFn: async () => {
      const response = await fetch('/api/staff/surveys', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`catalog: ${response.status}`);
      return (await response.json()) as CatalogRow[];
    },
    retry: false,
  });
  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/staff/surveys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, kind, ...(licensedSource ? { licensedSource } : {}) }),
      });
      if (!response.ok) throw new Error(`create: ${response.status}`);
      return (await response.json()) as { versionId: string };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['survey-catalog'] });
      await navigate({ to: '/surveys/builder/$versionId', params: { versionId: data.versionId } });
    },
  });
  const newDraft = useMutation({
    mutationFn: async (surveyId: string) => {
      const response = await fetch(`/api/staff/surveys/${surveyId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      if (!response.ok) throw new Error(`draft: ${response.status}`);
      return (await response.json()) as { versionId: string };
    },
    onSuccess: (data) =>
      void navigate({ to: '/surveys/builder/$versionId', params: { versionId: data.versionId } }),
  });

  if (catalog.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (catalog.isError) return <ErrorState onRetry={() => void catalog.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl italic text-ink">
          <FormattedMessage id="builder.catalogTitle" />
        </h1>
        <Button size="sm" onPress={() => setDialogOpen(true)}>
          <FormattedMessage id="builder.newSurvey" />
        </Button>
      </div>

      <div className="overflow-x-auto rounded-card border border-black/5 bg-surface shadow-resting">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">
                <FormattedMessage id="builder.survey" />
              </th>
              <th className="px-3 py-3 font-medium">
                <FormattedMessage id="builder.versions" />
              </th>
              <th className="px-3 py-3 font-medium">
                <FormattedMessage id="builder.inUse" />
              </th>
              <th className="px-3 py-3 font-medium">
                <span className="sr-only">
                  <FormattedMessage id="catalog.actions" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {catalog.data.map((row) => {
              const versions = row.versions ?? [];
              const newest = versions[0];
              const hasDraft = versions.some((entry) => entry.state === 'draft');
              return (
                <tr key={row.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink">
                      {row.name}
                      {row.licensed_source ? (
                        <span
                          className="ml-2 text-xs font-normal text-muted"
                          title={row.licensed_source}
                        >
                          <FormattedMessage id="assign.licensed" />
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-secondary">
                      {intl.formatMessage({ id: `builder.kind.${row.kind}` })}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {versions.map((entry) => (
                        <StatusChip
                          key={entry.id}
                          tone={STATE_TONE[entry.state as keyof typeof STATE_TONE] ?? 'neutral'}
                        >
                          {`v${entry.version} · ${intl.formatMessage({ id: `catalog.state.${entry.state}` })}`}
                        </StatusChip>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-secondary">
                    <FormattedMessage id="builder.programs" values={{ count: row.in_use }} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {newest ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          onPress={() =>
                            void navigate({
                              to: '/surveys/builder/$versionId',
                              params: { versionId: newest.id },
                            })
                          }
                        >
                          <FormattedMessage id="builder.open" />
                        </Button>
                      ) : null}
                      {!hasDraft && !row.licensed_source ? (
                        <Button
                          variant="quiet"
                          size="sm"
                          isDisabled={newDraft.isPending}
                          onPress={() => void newDraft.mutate(row.id)}
                        >
                          <FormattedMessage id="builder.newDraft" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialogOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-survey-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDialogOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-raised">
            <h2 id="new-survey-title" className="font-display text-lg italic text-ink">
              <FormattedMessage id="builder.newSurvey" />
            </h2>
            <label className="mt-4 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="builder.nameLabel" />
              <input
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="schedule.kind" />
              <select
                className={inputClass}
                value={kind}
                onChange={(event) => setKind(event.currentTarget.value)}
              >
                <option value="symptom">
                  {intl.formatMessage({ id: 'builder.kind.symptom' })}
                </option>
                <option value="generic">
                  {intl.formatMessage({ id: 'builder.kind.generic' })}
                </option>
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
              <FormattedMessage id="builder.licensedLabel" />
              <input
                className={inputClass}
                value={licensedSource}
                placeholder={intl.formatMessage({ id: 'builder.licensedPlaceholder' })}
                onChange={(event) => setLicensedSource(event.currentTarget.value)}
              />
            </label>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              <FormattedMessage id="builder.licensedNote" />
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="quiet" onPress={() => setDialogOpen(false)}>
                <FormattedMessage id="common.cancel" />
              </Button>
              <Button
                isDisabled={name.trim() === '' || create.isPending}
                onPress={() => void create.mutate()}
              >
                <FormattedMessage id="builder.create" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
