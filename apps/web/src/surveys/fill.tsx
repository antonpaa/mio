import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  progressOf,
  validateAnswer,
  visibleQuestions,
  type Answers,
  type LocaleBundle,
  type Question,
  type SurveyDefinition,
} from '@mio/survey-schema';
import { BodyMap, Button, ErrorState, Skeleton } from '@mio/ui';
import { BODY_REGIONS } from '@mio/survey-schema';

/**
 * P4: one question per step. The SAME engine that the server validates
 * with drives visibility and progress here, so "2 of 8" and the follow-up
 * flow can never disagree with what submit() will accept.
 */

interface FillPayload {
  responseId: string;
  status: 'draft' | 'submitted';
  kind: 'symptom' | 'generic';
  definition: SurveyDefinition;
  bundle: LocaleBundle;
  answers: Answers;
}

export function SurveyFillPage(): ReactElement {
  const intl = useIntl();
  const navigate = useNavigate();
  const { responseId } = useParams({ strict: false }) as { responseId: string };
  const payload = useQuery({
    queryKey: ['response', responseId],
    queryFn: async () => {
      const response = await fetch(`/api/patient/responses/${responseId}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`response: ${response.status}`);
      return (await response.json()) as FillPayload;
    },
    retry: false,
    staleTime: Infinity,
  });

  if (payload.isPending) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 pt-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (payload.isError) return <ErrorState onRetry={() => void payload.refetch()} />;
  if (payload.data.status === 'submitted') {
    return (
      <div className="mx-auto max-w-xl pt-6 text-sm text-secondary">
        <FormattedMessage id="surveys.alreadySubmitted" />
      </div>
    );
  }
  return (
    <FillFrame initial={payload.data} responseId={responseId} navigate={navigate} intl={intl} />
  );
}

function FillFrame({
  initial,
  responseId,
  navigate,
  intl,
}: {
  initial: FillPayload;
  responseId: string;
  navigate: ReturnType<typeof useNavigate>;
  intl: ReturnType<typeof useIntl>;
}): ReactElement {
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [step, setStep] = useState(0);
  const [showError, setShowError] = useState(false);

  const { definition, bundle } = initial;
  const steps = visibleQuestions(definition, answers);
  const current = steps[Math.min(step, steps.length - 1)];
  const progress = progressOf(definition, answers);
  const isLast = step >= steps.length - 1;

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/patient/responses/${responseId}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) throw new Error(`save: ${response.status}`);
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/patient/responses/${responseId}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) throw new Error(`submit: ${response.status}`);
    },
    onSuccess: () => void navigate({ to: '/surveys/done/$responseId', params: { responseId } }),
  });

  if (!current) {
    return <ErrorState onRetry={() => window.location.reload()} />;
  }

  const value = answers[current.id];
  const answered =
    value !== undefined &&
    value !== null &&
    value !== '' &&
    (current.type !== 'choice_multi' || (Array.isArray(value) && value.length > 0));
  const errorCode = answered ? validateAnswer(current, value) : undefined;
  const requiredMissing = current.required === true && !answered;
  const blocked = requiredMissing || errorCode !== undefined;

  const advance = (): void => {
    if (blocked) {
      setShowError(true);
      return;
    }
    setShowError(false);
    save.mutate();
    if (isLast) submit.mutate();
    else setStep(step + 1);
  };

  const text = bundle.questions[current.id];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-xl italic text-ink">{bundle.title}</h1>
        <p className="text-sm text-muted" aria-live="polite">
          <FormattedMessage
            id="surveys.progressLabel"
            values={{ answered: progress.answered, total: progress.total }}
          />
        </p>
      </header>
      <div
        className="h-1.5 overflow-hidden rounded-pill bg-surface-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.answered}
        aria-label={intl.formatMessage({ id: 'surveys.title' })}
      >
        <div
          className="h-full rounded-pill bg-teal transition-all"
          style={{
            width: `${progress.total === 0 ? 0 : (progress.answered / progress.total) * 100}%`,
          }}
        />
      </div>

      <section className="rounded-card border border-black/5 bg-surface p-6 shadow-resting">
        <h2 className="text-lg font-medium text-ink">
          {text?.label ?? current.id}
          {current.required !== true ? (
            <span className="ml-2 text-xs font-normal text-muted">
              <FormattedMessage id="surveys.optional" />
            </span>
          ) : null}
        </h2>
        {text?.description ? (
          <p className="mt-1 text-sm text-secondary">{text.description}</p>
        ) : null}

        <div className="mt-4">
          <QuestionInput
            question={current}
            text={text}
            value={value}
            onChange={(next) => {
              setShowError(false);
              setAnswers({ ...answers, [current.id]: next });
            }}
          />
        </div>

        {showError && requiredMissing ? (
          <p role="alert" className="mt-3 rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
            <FormattedMessage id="surveys.required" />
          </p>
        ) : null}
        {showError && errorCode !== undefined ? (
          <p role="alert" className="mt-3 rounded-inner bg-red-tint px-3 py-2 text-sm text-red">
            {errorCode === 'pattern' && text?.patternMessage
              ? text.patternMessage
              : intl.formatMessage({ id: 'surveys.invalid' })}
          </p>
        ) : null}
      </section>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="quiet"
          isDisabled={step === 0}
          onPress={() => {
            setShowError(false);
            setStep(Math.max(0, step - 1));
          }}
        >
          <FormattedMessage id="surveys.back" />
        </Button>
        <div className="flex gap-2">
          <Button
            variant="quiet"
            isDisabled={save.isPending}
            onPress={() => void save.mutateAsync().then(() => navigate({ to: '/surveys' }))}
          >
            <FormattedMessage id="surveys.saveExit" />
          </Button>
          <Button isDisabled={submit.isPending} onPress={advance}>
            <FormattedMessage id={isLast ? 'surveys.submit' : 'surveys.next'} />
          </Button>
        </div>
      </div>

      {initial.kind === 'symptom' ? (
        <p className="rounded-inner bg-amber-tint px-3 py-2.5 text-sm text-ink">
          <FormattedMessage id="surveys.escapeHatch" />
        </p>
      ) : null}
    </div>
  );
}

export function QuestionInput({
  question,
  text,
  value,
  onChange,
}: {
  question: Question;
  text: LocaleBundle['questions'][string] | undefined;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactElement {
  const inputClass =
    'w-full rounded-inner border border-border bg-surface px-3 py-2.5 text-sm text-ink';
  switch (question.type) {
    case 'body_map':
      return <BodyMapInput value={value} onChange={onChange} />;
    case 'choice_single':
      return (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={text?.label}>
          {(question.options ?? []).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={value === option.id}
              onClick={() => onChange(option.id)}
              className={`rounded-inner border px-4 py-3 text-left text-sm transition-colors ${
                value === option.id
                  ? 'border-teal bg-teal-tint font-medium text-teal'
                  : 'border-border bg-surface text-ink hover:bg-surface-sunken'
              }`}
            >
              {text?.options?.[option.id] ?? option.id}
            </button>
          ))}
        </div>
      );
    case 'choice_multi': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-2">
          {(question.options ?? []).map((option) => {
            const checked = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-center gap-3 rounded-inner border px-4 py-3 text-sm transition-colors ${
                  checked
                    ? 'border-teal bg-teal-tint font-medium text-teal'
                    : 'border-border bg-surface text-ink hover:bg-surface-sunken'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    onChange(
                      event.currentTarget.checked
                        ? [...selected, option.id]
                        : selected.filter((entry) => entry !== option.id),
                    )
                  }
                />
                {text?.options?.[option.id] ?? option.id}
              </label>
            );
          })}
        </div>
      );
    }
    case 'scale': {
      const { min, max } = question.scale ?? { min: 0, max: 10 };
      const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);
      return (
        <div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={text?.label}>
            {values.map((entry) => (
              <button
                key={entry}
                type="button"
                role="radio"
                aria-checked={value === entry}
                onClick={() => onChange(entry)}
                className={`h-10 w-10 rounded-inner border text-sm transition-colors ${
                  value === entry
                    ? 'border-teal bg-teal font-semibold text-surface'
                    : 'border-border bg-surface text-ink hover:bg-surface-sunken'
                }`}
              >
                {entry}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>{text?.scaleMinLabel}</span>
            <span>{text?.scaleMaxLabel}</span>
          </div>
        </div>
      );
    }
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            aria-label={text?.label}
            className={`${inputClass} block max-w-40`}
            value={typeof value === 'number' ? value : ''}
            step={
              question.validation?.decimals === 0
                ? 1
                : 1 / 10 ** (question.validation?.decimals ?? 2)
            }
            onChange={(event) => {
              const raw = event.currentTarget.value;
              onChange(raw === '' ? undefined : Number(raw));
            }}
          />
          {question.validation?.unit ? (
            <span className="text-sm text-secondary">{question.validation.unit}</span>
          ) : null}
        </div>
      );
    case 'date':
      return (
        <input
          type="date"
          aria-label={text?.label}
          className={`${inputClass} block max-w-52`}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.currentTarget.value || undefined)}
        />
      );
    case 'text':
      return (
        <textarea
          aria-label={text?.label}
          className={`${inputClass} min-h-20 resize-y`}
          value={typeof value === 'string' ? value : ''}
          maxLength={question.validation?.maxLength ?? 4000}
          onChange={(event) => onChange(event.currentTarget.value || undefined)}
        />
      );
  }
}

function BodyMapInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactElement {
  const intl = useIntl();
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const labels = Object.fromEntries(
    BODY_REGIONS.map((region) => [
      region.id,
      intl.formatMessage({ id: `bodymap.region.${region.id}` }),
    ]),
  );
  const summary =
    selected.length === 0
      ? intl.formatMessage({ id: 'bodymap.none' })
      : intl.formatMessage(
          { id: 'bodymap.summary' },
          {
            count: selected.length,
            list: selected.map((id) => labels[id] ?? id).join(', '),
          },
        );
  return (
    <BodyMap
      selected={selected}
      onToggle={(regionId) =>
        onChange(
          selected.includes(regionId)
            ? selected.filter((entry) => entry !== regionId)
            : [...selected, regionId],
        )
      }
      labels={labels}
      viewLabels={{
        front: intl.formatMessage({ id: 'bodymap.front' }),
        back: intl.formatMessage({ id: 'bodymap.back' }),
      }}
      legendLabel={intl.formatMessage({ id: 'bodymap.legend' })}
      summary={summary}
    />
  );
}
