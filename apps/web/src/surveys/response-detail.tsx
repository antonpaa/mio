import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl';
import {
  allQuestions,
  type LocaleBundle,
  type ProgramOverrides,
  type Question,
  type QuestionRule,
  type SurveyDefinition,
  type TrendRule,
} from '@mio/survey-schema';
import { BodyMapView, Button, ErrorState, SeverityChip, Skeleton, StatusChip } from '@mio/ui';
import { capabilityUnion, sessionRoles } from '../app/shells.js';
import { useSession } from '../session/session.js';

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
    version_id: string;
    treatment_name: string;
    survey_name: string;
    patient_given: string;
    patient_family: string;
    behalf_given: string | null;
    behalf_family: string | null;
  };
  definition: SurveyDefinition;
  effectiveDefinition?: SurveyDefinition;
  locales: LocaleBundle[];
  overrides: ProgramOverrides;
  standing: Record<string, 'above_expected' | 'critical_area' | 'expected'>;
  triggers: {
    id: string;
    rule_id: string;
    severity: 'low' | 'moderate' | 'high' | null;
    alert_id: string | null;
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
  const firstAlertId = triggers.find((trigger) => trigger.alert_id !== null)?.alert_id ?? null;
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
                  {question.type === 'body_map' && Array.isArray(response.answers[question.id]) ? (
                    <span className="mt-2 block">
                      <BodyMapView
                        selected={response.answers[question.id] as string[]}
                        viewLabels={{
                          front: intl.formatMessage({ id: 'bodymap.front' }),
                          back: intl.formatMessage({ id: 'bodymap.back' }),
                        }}
                      />
                    </span>
                  ) : null}
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

      <RulesCard
        definition={detail.data.effectiveDefinition ?? definition}
        bundle={bundle}
        versionId={response.version_id}
      />
      {firstAlertId !== null ? <AlertCommentsCard alertId={firstAlertId} /> : null}
    </div>
  );
}

/** One rule condition in prose, from the bundle's own labels. */
function whenProse(
  intl: IntlShape,
  label: string,
  text: LocaleBundle['questions'][string] | undefined,
  when: QuestionRule['when'],
): string {
  switch (when.kind) {
    case 'option':
      return intl.formatMessage(
        { id: 'c7.when.option' },
        { label, value: text?.options?.[when.optionId] ?? when.optionId },
      );
    case 'at_least':
      return intl.formatMessage({ id: 'c7.when.atLeast' }, { label, value: when.value });
    case 'at_most':
      return intl.formatMessage({ id: 'c7.when.atMost' }, { label, value: when.value });
    case 'critical_region':
      return intl.formatMessage({ id: 'c7.when.criticalRegion' }, { label });
    case 'other_region':
      return intl.formatMessage({ id: 'c7.when.otherRegion' }, { label });
    case 'region_count':
      return intl.formatMessage({ id: 'c7.when.regionCount' }, { label, value: when.value });
  }
}

function trendProse(intl: IntlShape, bundle: LocaleBundle, rule: TrendRule): string {
  const when = rule.when;
  if (when.kind === 'missed') {
    return intl.formatMessage({ id: 'c7.trend.missed' }, { times: when.times });
  }
  const text = bundle.questions[when.questionId];
  const label = text?.label ?? when.questionId;
  if (when.kind === 'repeat') {
    const value =
      when.match.kind === 'option'
        ? (text?.options?.[when.match.optionId] ?? when.match.optionId)
        : whenProse(intl, label, text, when.match);
    return intl.formatMessage({ id: 'c7.trend.repeat' }, { label, value, times: when.times });
  }
  return intl.formatMessage(
    { id: when.kind === 'decreasing' ? 'c7.trend.decreasing' : 'c7.trend.increasing' },
    { label, times: when.times },
  );
}

const RULE_SEVERITIES = ['high', 'moderate', 'low'] as const;

/** X18(iv): the canvas's "Alert rules of this program" - the effective
 * rule set (program overrides applied server-side) in plain language,
 * grouped by what a firing raises. */
function RulesCard({
  definition,
  bundle,
  versionId,
}: {
  definition: SurveyDefinition;
  bundle: LocaleBundle | undefined;
  versionId: string;
}): ReactElement | null {
  const intl = useIntl();
  const session = useSession();
  const canAuthor = capabilityUnion(sessionRoles(session)).has('survey_template.view');

  const entries: {
    severity: 'high' | 'moderate' | 'low' | null;
    text: string;
    program: boolean;
  }[] = [];
  for (const question of allQuestions(definition)) {
    const text = bundle?.questions[question.id];
    const label = text?.label ?? question.id;
    for (const rule of question.rules ?? []) {
      const alert = rule.outcomes.find((outcome) => outcome.kind === 'alert');
      entries.push({
        severity: alert !== undefined && alert.kind === 'alert' ? alert.severity : null,
        text: whenProse(intl, label, text, rule.when),
        program: rule.source === 'program',
      });
    }
  }
  for (const rule of definition.trendRules ?? []) {
    const alert = rule.outcomes.find((outcome) => outcome.kind === 'alert');
    entries.push({
      severity: alert !== undefined && alert.kind === 'alert' ? alert.severity : null,
      text: bundle !== undefined ? trendProse(intl, bundle, rule) : rule.id,
      program: rule.source === 'program',
    });
  }
  if (entries.length === 0) return null;

  const groupText = (list: typeof entries): string =>
    list
      .map(
        (entry) =>
          entry.text +
          (entry.program ? ` (${intl.formatMessage({ id: 'rules.layer.program' })})` : ''),
      )
      .join('; ');
  const recordsOnly = entries.filter((entry) => entry.severity === null);

  return (
    <section className="rounded-card border border-black/5 bg-surface p-5 shadow-resting">
      <h2 className="font-display text-lg italic text-ink">
        <FormattedMessage id="c7.rulesTitle" />
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {RULE_SEVERITIES.map((severity) => {
          const group = entries.filter((entry) => entry.severity === severity);
          if (group.length === 0) return null;
          return (
            <li key={severity} className="flex flex-wrap items-start gap-2 text-sm text-ink">
              <span className="flex w-28 shrink-0">
                <SeverityChip
                  severity={severity}
                  label={intl.formatMessage({ id: `severity.${severity}` })}
                />
              </span>
              <span className="min-w-0 flex-1">{groupText(group)}</span>
            </li>
          );
        })}
        {recordsOnly.length > 0 ? (
          <li className="flex flex-wrap items-start gap-2 text-sm text-ink">
            <span className="flex w-28 shrink-0">
              <StatusChip tone="neutral">
                {intl.formatMessage({ id: 'alerts.recordOnly' })}
              </StatusChip>
            </span>
            <span className="min-w-0 flex-1">{groupText(recordsOnly)}</span>
          </li>
        ) : null}
      </ul>
      <p className="mt-3 border-t border-hairline pt-2.5 text-xs text-muted">
        <FormattedMessage id="c7.rulesExpected" />
        {canAuthor ? (
          <>
            {' '}
            <Link
              to="/surveys/builder/$versionId"
              params={{ versionId }}
              className="font-medium text-teal underline underline-offset-4 hover:text-teal-hover"
            >
              <FormattedMessage id="c7.editRules" />
            </Link>
          </>
        ) : null}
      </p>
    </section>
  );
}

/** X18(iv): the alert's comment thread right on the response - posted
 * to the same append-only trail PP6 shows, cache shared with it. */
function AlertCommentsCard({ alertId }: { alertId: string }): ReactElement {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const detail = useQuery({
    queryKey: ['alerts', alertId],
    queryFn: async () => {
      const response = await fetch(`/api/staff/alerts/${alertId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`alert: ${response.status}`);
      return (await response.json()) as {
        comments: {
          id: string;
          body: string;
          created_at: string;
          author_given: string;
          author_family: string;
        }[];
      };
    },
    retry: false,
  });
  const post = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/staff/alerts/${alertId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body: comment }),
      });
      if (!response.ok) throw new Error(`comment: ${response.status}`);
    },
    onSuccess: () => {
      setComment('');
      void queryClient.invalidateQueries({ queryKey: ['alerts', alertId] });
    },
  });

  return (
    <section className="rounded-card border border-black/5 bg-surface p-5 shadow-resting">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg italic text-ink">
          <FormattedMessage id="c7.alertComments" />
        </h2>
        <Link
          to="/alerts/$alertId"
          params={{ alertId }}
          className="text-sm font-medium text-teal underline-offset-4 hover:underline"
        >
          <FormattedMessage id="c7.openAlert" />
        </Link>
      </div>
      {detail.data !== undefined && detail.data.comments.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {detail.data.comments.map((entry) => (
            <li key={entry.id} className="text-sm text-ink">
              <span className="block text-xs text-muted">
                {entry.author_given} {entry.author_family}
                {' — '}
                {intl.formatDate(entry.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              {entry.body}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-inner border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder={intl.formatMessage({ id: 'alerts.commentPlaceholder' })}
          aria-label={intl.formatMessage({ id: 'alerts.comment' })}
          value={comment}
          onChange={(event) => setComment(event.currentTarget.value)}
        />
        <Button
          size="sm"
          variant="quiet"
          isDisabled={comment.trim() === '' || post.isPending}
          onPress={() => post.mutate()}
        >
          <FormattedMessage id="alerts.commentSend" />
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        <FormattedMessage id="c7.commentsAudited" />
      </p>
    </section>
  );
}
