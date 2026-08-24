import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl';
import {
  allQuestions,
  type LocaleBundle,
  type ProgramOverrides,
  type Question,
  type SurveyDefinition,
} from '@mio/survey-schema';
import { ErrorState, SeverityChip, Skeleton, StatusChip } from '@mio/ui';

/**
 * C7: one response, every answer against THIS program's rules. The
 * standing chips are the program's judgement of the stored facts -
 * "Above expected", "Expected in this program", "Critical area" - and
 * the context line says when the judgement came from a program override
 * rather than the template. Always the WHOLE response, bound to its
 * exact version.
 */

interface DetailPayload {
  response: {
    id: string;
    status: string;
    locale: string;
    submitted_at: string | null;
    answers: Record<string, unknown>;
    treatment_id: string;
    patient_id: string;
    version: number;
    treatment_name: string;
    survey_name: string;
    patient_given: string;
    patient_family: string;
    behalf_given: string | null;
    behalf_family: string | null;
  };
  definition: SurveyDefinition;
  locales: LocaleBundle[];
  overrides: ProgramOverrides;
  standing: Record<string, 'above_expected' | 'critical_area' | 'expected'>;
  triggers: {
    id: string;
    rule_id: string;
    severity: 'low' | 'moderate' | 'high' | null;
    source: 'template' | 'program';
    citation: {
      questionLabel: string;
      kind: string;
      valueLabel?: string;
      threshold?: number;
      observed?: unknown;
      regions?: string[];
      times?: number;
    };
  }[];
}

function renderAnswer(
  intl: IntlShape,
  question: Question,
  text: LocaleBundle['questions'][string] | undefined,
  value: unknown,
): string {
  if (question.type === 'choice_single' && typeof value === 'string') {
    return text?.options?.[value] ?? value;
  }
  if (question.type === 'choice_multi' && Array.isArray(value)) {
    return value.map((entry) => text?.options?.[entry as string] ?? String(entry)).join(', ');
  }
  if (question.type === 'body_map' && Array.isArray(value)) {
    return value
      .map((region) => intl.formatMessage({ id: `bodymap.region.${region as string}` }))
      .join(', ');
  }
  if (question.type === 'number' && typeof value === 'number') {
    return `${value}${question.validation?.unit ? ` ${question.validation.unit}` : ''}`;
  }
  if (question.type === 'date' && typeof value === 'string') {
    return intl.formatDate(value, { dateStyle: 'medium' });
  }
  return String(value);
}

const STANDING_TONE = { above_expected: 'amber', critical_area: 'red', expected: 'teal' } as const;

export function ResponseDetailPage(): ReactElement {
  const { responseId } = useParams({ strict: false }) as { responseId: string };
  const intl = useIntl();
  const detail = useQuery({
    queryKey: ['response-detail', responseId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/responses/${responseId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`response: ${response.status}`);
      return (await response.json()) as DetailPayload;
    },
    retry: false,
  });

  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />;

  const { response, definition, locales, overrides, standing, triggers } = detail.data;
  const bundle = locales.find((entry) => entry.locale === response.locale) ?? locales[0];
  const overriddenCount =
    Object.keys(overrides.rules ?? {}).length + Object.keys(overrides.criticalRegions ?? {}).length;
  const answered = allQuestions(definition).filter((question) => {
    const value = response.answers[question.id];
    return (
      value !== undefined &&
      value !== null &&
      value !== '' &&
      (!Array.isArray(value) || value.length > 0)
    );
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl italic text-ink">{response.survey_name}</h1>
          <StatusChip tone="neutral">{`v${response.version}`}</StatusChip>
        </div>
        <p className="mt-1 text-sm text-secondary">
          <Link
            to="/patients/$patientId"
            params={{ patientId: response.patient_id }}
            className="text-teal underline-offset-4 hover:underline"
          >
            {response.patient_given} {response.patient_family}
          </Link>
          {' — '}
          {response.treatment_name}
          {' — '}
          {response.submitted_at !== null
            ? intl.formatDate(response.submitted_at, { dateStyle: 'medium', timeStyle: 'short' })
            : intl.formatMessage({ id: 'c7.draft' })}
          {response.behalf_given !== null ? (
            <span className="ml-1 text-muted">
              {intl.formatMessage(
                { id: 'c7.onBehalf' },
                { name: `${response.behalf_given} ${response.behalf_family ?? ''}`.trim() },
              )}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-muted">
          {overriddenCount > 0 ? (
            <FormattedMessage id="c7.programContext" values={{ count: overriddenCount }} />
          ) : (
            <FormattedMessage id="c7.templateContext" />
          )}
        </p>
      </header>

      <section className="rounded-card border border-black/5 bg-surface shadow-resting">
        <ul className="divide-y divide-hairline">
          {answered.map((question) => {
            const text = bundle?.questions[question.id];
            const state = standing[question.id] ?? 'expected';
            return (
              <li key={question.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">
                    {text?.label || question.id}
                  </span>
                  <span className="block text-sm text-secondary">
                    {renderAnswer(intl, question, text, response.answers[question.id])}
                  </span>
                </span>
                <StatusChip tone={STANDING_TONE[state]}>
                  {intl.formatMessage({ id: `c7.standing.${state}` })}
                </StatusChip>
              </li>
            );
          })}
        </ul>
      </section>

      {triggers.length > 0 ? (
        <section className="rounded-card border border-black/5 bg-surface p-5 shadow-resting">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            <FormattedMessage id="alerts.triggers" />
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {triggers.map((trigger) => (
              <li key={trigger.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <span className="flex min-w-28 shrink-0">
                  {trigger.severity !== null ? (
                    <SeverityChip
                      severity={trigger.severity}
                      label={intl.formatMessage({ id: `severity.${trigger.severity}` })}
                    />
                  ) : (
                    <StatusChip tone="neutral">
                      {intl.formatMessage({ id: 'alerts.recordOnly' })}
                    </StatusChip>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  {trigger.citation.questionLabel}
                  {trigger.citation.valueLabel !== undefined
                    ? `: “${trigger.citation.valueLabel}”`
                    : trigger.citation.observed !== undefined
                      ? `: ${String(trigger.citation.observed)}${trigger.citation.threshold !== undefined ? ` (≥ ${trigger.citation.threshold})` : ''}`
                      : ''}
                </span>
                <StatusChip tone={trigger.source === 'program' ? 'amber' : 'neutral'}>
                  {intl.formatMessage({ id: `rules.layer.${trigger.source}` })}
                </StatusChip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
