import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  visibleQuestions,
  type Answers,
  type LocaleBundle,
  type SurveyDefinition,
} from '@mio/survey-schema';
import { BodyMapView, ErrorState, Skeleton } from '@mio/ui';

/** P12: a calm confirmation with the answer summary. The plain-language
 * "closer look" wording is tracked for clinical sign-off (register P4). */

interface SubmittedPayload {
  status: string;
  definition: SurveyDefinition;
  bundle: LocaleBundle;
  answers: Answers;
  submittedAt: string | null;
}

function renderAnswer(
  bundle: LocaleBundle,
  questionId: string,
  value: unknown,
  regionLabel: (id: string) => string | undefined,
): string {
  const text = bundle.questions[questionId];
  if (Array.isArray(value)) {
    return value
      .map(
        (entry) =>
          text?.options?.[entry as string] ?? regionLabel(entry as string) ?? String(entry),
      )
      .join(', ');
  }
  if (typeof value === 'string' && text?.options?.[value]) return text.options[value]!;
  return String(value);
}

export function SurveySubmittedPage(): ReactElement {
  const intl = useIntl();
  const { responseId } = useParams({ strict: false }) as { responseId: string };
  const payload = useQuery({
    queryKey: ['response', responseId, 'submitted'],
    queryFn: async () => {
      const response = await fetch(`/api/patient/responses/${responseId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`response: ${response.status}`);
      return (await response.json()) as SubmittedPayload;
    },
    retry: false,
  });

  if (payload.isPending) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 pt-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (payload.isError) return <ErrorState onRetry={() => void payload.refetch()} />;
  const { definition, bundle, answers } = payload.data;
  const answeredQuestions = visibleQuestions(definition, answers).filter(
    (question) => answers[question.id] !== undefined,
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <header className="rounded-card border border-black/5 bg-surface p-6 text-center shadow-resting">
        <p
          aria-hidden
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-teal-tint text-2xl text-teal"
        >
          ✓
        </p>
        <h1 className="mt-1 font-display text-2xl italic text-ink">
          <FormattedMessage id="surveys.submittedTitle" />
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-secondary">
          <FormattedMessage id="surveys.submittedNote" />
        </p>
      </header>

      <section className="rounded-card border border-black/5 bg-surface px-6 py-5 shadow-resting">
        <h2 className="mb-3 text-sm font-semibold text-ink">
          <FormattedMessage id="surveys.yourAnswers" />
        </h2>
        <dl className="flex flex-col gap-3">
          {answeredQuestions.map((question) => (
            <div
              key={question.id}
              className="border-b border-hairline pb-3 last:border-b-0 last:pb-0"
            >
              <dt className="text-xs text-muted">{bundle.questions[question.id]?.label}</dt>
              {question.type === 'body_map' && Array.isArray(answers[question.id]) ? (
                <dd className="mt-2">
                  <BodyMapView
                    selected={answers[question.id] as string[]}
                    viewLabels={{
                      front: intl.formatMessage({ id: 'bodymap.front' }),
                      back: intl.formatMessage({ id: 'bodymap.back' }),
                    }}
                  />
                </dd>
              ) : null}
              <dd className="mt-0.5 text-sm text-ink">
                {renderAnswer(bundle, question.id, answers[question.id], (id) =>
                  question.type === 'body_map'
                    ? intl.formatMessage({ id: `bodymap.region.${id}` })
                    : undefined,
                )}
                {question.validation?.unit ? ` ${question.validation.unit}` : ''}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="text-center">
        <Link to="/" className="text-sm text-teal hover:text-teal-hover">
          <FormattedMessage id="surveys.backHome" />
        </Link>
      </div>
    </div>
  );
}
