import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button, EmptyState, ErrorState, ListRow, Skeleton, StatusChip } from '@mio/ui';
import { useLocaleControls } from '../app/locale-context.js';

/** P3 (minimal, WP-14): what can be filled now, open drafts, recent
 * submissions. Due dates and occurrences ride WP-17. */

interface SurveyList {
  due: {
    activityId: string;
    responseId: string | null;
    dueDate: string;
    overdue: boolean;
    title: string;
    treatmentName: string;
  }[];
  fillable: {
    surveyId: string;
    treatmentId: string;
    treatmentName: string;
    kind: string;
    titles: Record<string, string>;
  }[];
  drafts: {
    responseId: string;
    title: string;
    progress: { answered: number; total: number };
  }[];
  submitted: { responseId: string; title: string; submittedAt: string }[];
}

export function PatientSurveysPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const { locale } = useLocaleControls();
  const surveys = useQuery({
    queryKey: ['patient-surveys'],
    queryFn: async () => {
      const response = await fetch('/api/patient/surveys', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`surveys: ${response.status}`);
      return (await response.json()) as SurveyList;
    },
    retry: false,
  });
  const fillOccurrence = useMutation({
    mutationFn: async (activityId: string) => {
      const response = await fetch(`/api/patient/activities/${activityId}/fill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });
      if (!response.ok) throw new Error(`fill: ${response.status}`);
      return (await response.json()) as { responseId: string };
    },
    onSuccess: (data) =>
      void navigate({ to: '/surveys/fill/$responseId', params: { responseId: data.responseId } }),
  });
  const start = useMutation({
    mutationFn: async (input: { surveyId: string; treatmentId: string }) => {
      const response = await fetch(`/api/patient/surveys/${input.surveyId}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ treatmentId: input.treatmentId }),
      });
      if (!response.ok) throw new Error(`start: ${response.status}`);
      return (await response.json()) as { responseId: string };
    },
    onSuccess: (data) =>
      void navigate({ to: '/surveys/fill/$responseId', params: { responseId: data.responseId } }),
  });

  if (surveys.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (surveys.isError) return <ErrorState onRetry={() => void surveys.refetch()} />;
  const data = surveys.data;
  const nothing =
    data.due.length === 0 &&
    data.fillable.length === 0 &&
    data.drafts.length === 0 &&
    data.submitted.length === 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <h1 className="font-display text-2xl italic text-ink">
        <FormattedMessage id="surveys.title" />
      </h1>

      {nothing ? (
        <EmptyState title={intl.formatMessage({ id: 'surveys.emptyTitle' })}>
          <FormattedMessage id="surveys.empty" />
        </EmptyState>
      ) : null}

      {data.due.length > 0 ? (
        <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
          <h2 className="mb-1 text-sm font-semibold text-ink">
            <FormattedMessage id="surveys.dueHeading" />
          </h2>
          {data.due.map((entry) => (
            <ListRow
              key={entry.activityId}
              trailing={
                <div className="flex items-center gap-2">
                  {entry.overdue ? (
                    <StatusChip tone="red">
                      {intl.formatMessage({ id: 'surveys.overdue' })}
                    </StatusChip>
                  ) : (
                    <StatusChip tone="neutral">
                      {intl.formatDate(`${entry.dueDate}T12:00:00`, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </StatusChip>
                  )}
                  <Button
                    size="sm"
                    isDisabled={fillOccurrence.isPending}
                    onPress={() => void fillOccurrence.mutate(entry.activityId)}
                  >
                    <FormattedMessage
                      id={entry.responseId !== null ? 'surveys.resume' : 'surveys.fill'}
                    />
                  </Button>
                </div>
              }
            >
              <p className="text-sm font-medium text-ink">{entry.title}</p>
              <p className="text-xs text-secondary">{entry.treatmentName}</p>
            </ListRow>
          ))}
        </section>
      ) : null}

      {data.drafts.length > 0 ? (
        <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
          <h2 className="mb-1 text-sm font-semibold text-ink">
            <FormattedMessage id="surveys.continueHeading" />
          </h2>
          {data.drafts.map((draft) => (
            <ListRow
              key={draft.responseId}
              trailing={
                <Button
                  variant="quiet"
                  size="sm"
                  onPress={() =>
                    void navigate({
                      to: '/surveys/fill/$responseId',
                      params: { responseId: draft.responseId },
                    })
                  }
                >
                  <FormattedMessage id="surveys.resume" />
                </Button>
              }
            >
              <p className="text-sm font-medium text-ink">{draft.title}</p>
              <p className="text-xs text-secondary">
                <FormattedMessage
                  id="surveys.progressLabel"
                  values={{ answered: draft.progress.answered, total: draft.progress.total }}
                />
              </p>
            </ListRow>
          ))}
        </section>
      ) : null}

      {data.fillable.length > 0 ? (
        <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
          <h2 className="mb-1 text-sm font-semibold text-ink">
            <FormattedMessage id="surveys.toFill" />
          </h2>
          {data.fillable.map((entry) => (
            <ListRow
              key={`${entry.surveyId}-${entry.treatmentId}`}
              trailing={
                <Button
                  size="sm"
                  isDisabled={start.isPending}
                  onPress={() =>
                    void start.mutate({ surveyId: entry.surveyId, treatmentId: entry.treatmentId })
                  }
                >
                  <FormattedMessage id="surveys.start" />
                </Button>
              }
            >
              <p className="text-sm font-medium text-ink">
                {entry.titles[locale] ?? entry.titles['en']}
              </p>
              <p className="text-xs text-secondary">{entry.treatmentName}</p>
            </ListRow>
          ))}
        </section>
      ) : null}

      {data.submitted.length > 0 ? (
        <section className="rounded-card border border-black/5 bg-surface px-5 py-4 shadow-resting">
          <h2 className="mb-1 text-sm font-semibold text-ink">
            <FormattedMessage id="surveys.recentlySubmitted" />
          </h2>
          {data.submitted.map((entry) => (
            <ListRow
              key={entry.responseId}
              trailing={
                <StatusChip tone="teal">
                  {intl.formatDate(entry.submittedAt, { day: 'numeric', month: 'short' })}
                </StatusChip>
              }
            >
              <p className="text-sm text-ink">{entry.title}</p>
            </ListRow>
          ))}
        </section>
      ) : null}
    </div>
  );
}
