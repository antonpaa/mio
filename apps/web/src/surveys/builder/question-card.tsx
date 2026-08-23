import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  BODY_REGIONS,
  isSafePattern,
  type Condition,
  type LocaleBundle,
  type Question,
} from '@mio/survey-schema';
import { Button } from '@mio/ui';

/**
 * One question in the editor (B2), with validation config (B6), the
 * visibility condition (B5) and nested follow-ups. The card mutates a
 * DRAFT copy through the callbacks; the page owns state and saving.
 */

export type QuestionText = NonNullable<LocaleBundle['questions'][string]>;

const inputClass =
  'mt-1 w-full rounded-inner border border-border bg-surface px-2.5 py-1.5 text-sm text-ink';
const smallInput =
  'mt-1 w-20 rounded-inner border border-border bg-surface px-2 py-1.5 text-sm text-ink';

export const QUESTION_TYPES = [
  'choice_single',
  'choice_multi',
  'scale',
  'number',
  'date',
  'text',
  'body_map',
] as const;

export function QuestionCard({
  question,
  text,
  earlier,
  earlierTextOf,
  depth,
  nextId,
  onChange,
  onChangeText,
  onRemove,
}: {
  question: Question;
  /** the ACTIVE locale's text for this question */
  text: QuestionText | undefined;
  /** questions before this one in traversal order - condition targets */
  earlier: Question[];
  earlierTextOf: (id: string) => QuestionText | undefined;
  depth: number;
  /** mints a fresh unique question id */
  nextId: () => string;
  onChange: (next: Question) => void;
  onChangeText: (next: QuestionText) => void;
  onRemove: () => void;
}): ReactElement {
  const intl = useIntl();
  type Loose<T> = { [K in keyof T]?: T[K] | undefined };
  const clean = <T extends object>(value: Loose<T>): T =>
    Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
  const patch = (partial: Loose<Question>): void =>
    onChange(clean<Question>({ ...question, ...partial }));
  const patchText = (partial: Loose<QuestionText>): void =>
    onChangeText(clean<QuestionText>({ label: text?.label ?? '', ...text, ...partial }));
  const patchValidation = (partial: Loose<NonNullable<Question['validation']>>): void =>
    patch({ validation: clean({ ...question.validation, ...partial }) });

  const options = question.options ?? [];
  const patternUnsafe =
    question.validation?.pattern !== undefined &&
    question.validation.pattern !== '' &&
    !isSafePattern(question.validation.pattern);
  const conditionTarget = earlier.find((entry) => entry.id === question.condition?.questionId);

  return (
    <div
      className={`rounded-inner border border-hairline bg-surface p-4 ${depth > 0 ? 'ml-6 border-l-2 border-l-teal-chip-border' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-muted">{question.id}</span>
        <label className="flex items-center gap-1.5 text-xs font-medium text-secondary">
          <span className="sr-only">
            <FormattedMessage id="builder.qType" />
          </span>
          <select
            className="rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink"
            value={question.type}
            onChange={(event) => {
              const type = event.currentTarget.value as Question['type'];
              const next: Question = { ...question, type };
              if (type === 'choice_single' || type === 'choice_multi') {
                next.options = question.options?.length ? question.options : [{ id: 'o-1' }];
              } else {
                delete next.options;
              }
              if (type === 'scale') next.scale = question.scale ?? { min: 0, max: 10 };
              else delete next.scale;
              if (type !== 'body_map') delete next.criticalRegions;
              onChange(next);
            }}
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {intl.formatMessage({ id: `builder.type.${type}` })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={question.required === true}
            onChange={(event) => patch({ required: event.currentTarget.checked || undefined })}
          />
          <FormattedMessage id="builder.required" />
        </label>
        <div className="ml-auto flex gap-1.5">
          <Button
            variant="quiet"
            size="sm"
            onPress={() => {
              const parentOptions = question.options ?? [];
              const condition: Condition =
                parentOptions.length > 0
                  ? { questionId: question.id, op: 'equals', value: parentOptions[0]!.id }
                  : { questionId: question.id, op: 'gte', value: 1 };
              patch({
                followUps: [
                  ...(question.followUps ?? []),
                  { id: nextId(), type: 'choice_single', options: [{ id: 'o-1' }], condition },
                ],
              });
            }}
          >
            <FormattedMessage id="builder.addFollowUp" />
          </Button>
          <Button variant="danger" size="sm" onPress={onRemove}>
            <FormattedMessage id="builder.removeQuestion" />
          </Button>
        </div>
      </div>

      <label className="mt-3 block text-sm font-medium text-ink-strong-secondary">
        <FormattedMessage id="builder.qLabel" />
        <input
          className={inputClass}
          value={text?.label ?? ''}
          onChange={(event) => patchText({ label: event.currentTarget.value })}
        />
      </label>
      <label className="mt-2 block text-xs font-medium text-secondary">
        <FormattedMessage id="builder.qDescription" />
        <input
          className={inputClass}
          value={text?.description ?? ''}
          onChange={(event) => patchText({ description: event.currentTarget.value || undefined })}
        />
      </label>

      {question.type === 'choice_single' || question.type === 'choice_multi' ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            <FormattedMessage id="builder.options" />
          </p>
          {options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              <span className="w-12 font-mono text-xs text-muted">{option.id}</span>
              <input
                className="flex-1 rounded-inner border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
                aria-label={intl.formatMessage({ id: 'builder.optionLabel' }, { id: option.id })}
                value={text?.options?.[option.id] ?? ''}
                onChange={(event) =>
                  patchText({
                    options: { ...text?.options, [option.id]: event.currentTarget.value },
                  })
                }
              />
              <Button
                variant="quiet"
                size="sm"
                isDisabled={options.length <= 1}
                onPress={() => patch({ options: options.filter((_, i) => i !== index) })}
              >
                <FormattedMessage id="schedule.removePhase" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="quiet"
              size="sm"
              onPress={() => {
                let n = options.length + 1;
                while (options.some((option) => option.id === `o-${n}`)) n += 1;
                patch({ options: [...options, { id: `o-${n}` }] });
              }}
            >
              <FormattedMessage id="builder.addOption" />
            </Button>
          </div>
        </div>
      ) : null}

      {question.type === 'scale' ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.scaleMin" />
            <input
              type="number"
              className={smallInput}
              value={question.scale?.min ?? 0}
              onChange={(event) =>
                patch({
                  scale: {
                    min: Number(event.currentTarget.value),
                    max: question.scale?.max ?? 10,
                  },
                })
              }
            />
          </label>
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.scaleMax" />
            <input
              type="number"
              className={smallInput}
              value={question.scale?.max ?? 10}
              onChange={(event) =>
                patch({
                  scale: { min: question.scale?.min ?? 0, max: Number(event.currentTarget.value) },
                })
              }
            />
          </label>
          <label className="block flex-1 text-xs font-medium text-secondary">
            <FormattedMessage id="builder.scaleMinLabel" />
            <input
              className={inputClass}
              value={text?.scaleMinLabel ?? ''}
              onChange={(event) =>
                patchText({ scaleMinLabel: event.currentTarget.value || undefined })
              }
            />
          </label>
          <label className="block flex-1 text-xs font-medium text-secondary">
            <FormattedMessage id="builder.scaleMaxLabel" />
            <input
              className={inputClass}
              value={text?.scaleMaxLabel ?? ''}
              onChange={(event) =>
                patchText({ scaleMaxLabel: event.currentTarget.value || undefined })
              }
            />
          </label>
        </div>
      ) : null}

      {question.type === 'number' ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.min" />
            <input
              type="number"
              className={smallInput}
              value={question.validation?.min ?? ''}
              onChange={(event) =>
                patchValidation({
                  min:
                    event.currentTarget.value === ''
                      ? undefined
                      : Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.max" />
            <input
              type="number"
              className={smallInput}
              value={question.validation?.max ?? ''}
              onChange={(event) =>
                patchValidation({
                  max:
                    event.currentTarget.value === ''
                      ? undefined
                      : Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.decimals" />
            <input
              type="number"
              min={0}
              max={6}
              className={smallInput}
              value={question.validation?.decimals ?? 2}
              onChange={(event) => patchValidation({ decimals: Number(event.currentTarget.value) })}
            />
          </label>
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.unit" />
            <input
              className={`${smallInput} w-24`}
              value={question.validation?.unit ?? ''}
              onChange={(event) =>
                patchValidation({ unit: event.currentTarget.value || undefined })
              }
            />
          </label>
        </div>
      ) : null}

      {question.type === 'text' ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.maxLength" />
            <input
              type="number"
              min={1}
              className={`${smallInput} w-24`}
              value={question.validation?.maxLength ?? ''}
              onChange={(event) =>
                patchValidation({
                  maxLength:
                    event.currentTarget.value === ''
                      ? undefined
                      : Number(event.currentTarget.value),
                })
              }
            />
          </label>
          <label className="block flex-1 text-xs font-medium text-secondary">
            <FormattedMessage id="builder.pattern" />
            <input
              className={`${inputClass} font-mono ${patternUnsafe ? 'border-red' : ''}`}
              value={question.validation?.pattern ?? ''}
              onChange={(event) =>
                patchValidation({ pattern: event.currentTarget.value || undefined })
              }
            />
          </label>
          <label className="block flex-1 text-xs font-medium text-secondary">
            <FormattedMessage id="builder.patternMessage" />
            <input
              className={inputClass}
              value={text?.patternMessage ?? ''}
              onChange={(event) =>
                patchText({ patternMessage: event.currentTarget.value || undefined })
              }
            />
          </label>
          {patternUnsafe ? (
            <p role="alert" className="w-full rounded-inner bg-red-tint px-3 py-2 text-xs text-red">
              <FormattedMessage id="builder.patternUnsafe" />
            </p>
          ) : null}
        </div>
      ) : null}

      {question.type === 'body_map' ? (
        <fieldset className="mt-3">
          <legend className="sr-only">
            <FormattedMessage id="builder.criticalRegions" />
          </legend>
          <p aria-hidden className="text-xs font-medium uppercase tracking-wide text-muted">
            ⚑ <FormattedMessage id="builder.criticalRegions" />
          </p>
          <p className="mt-0.5 text-xs text-muted">
            <FormattedMessage id="builder.criticalNote" />
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {BODY_REGIONS.map((region) => {
              const critical = question.criticalRegions?.includes(region.id) ?? false;
              return (
                <label key={region.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={critical}
                    onChange={() => {
                      const current = question.criticalRegions ?? [];
                      const next = critical
                        ? current.filter((entry) => entry !== region.id)
                        : [...current, region.id];
                      patch({ criticalRegions: next.length > 0 ? next : undefined });
                    }}
                  />
                  {intl.formatMessage({ id: `bodymap.region.${region.id}` })}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {earlier.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <span className="text-xs font-medium text-secondary">
            <FormattedMessage id="builder.visibleWhen" />
          </span>
          <select
            className="rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink"
            aria-label={intl.formatMessage({ id: 'builder.conditionTarget' })}
            value={question.condition?.questionId ?? ''}
            onChange={(event) => {
              const questionId = event.currentTarget.value;
              if (questionId === '') {
                const next = { ...question };
                delete next.condition;
                onChange(next);
                return;
              }
              const target = earlier.find((entry) => entry.id === questionId);
              const value =
                target?.options?.[0]?.id ??
                (target?.type === 'scale' ? (target.scale?.min ?? 0) : 1);
              patch({
                condition: { questionId, op: target?.options ? 'equals' : 'gte', value },
              });
            }}
          >
            <option value="">{intl.formatMessage({ id: 'builder.always' })}</option>
            {earlier.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {earlierTextOf(entry.id)?.label || entry.id}
              </option>
            ))}
          </select>
          {question.condition ? (
            <>
              <select
                className="rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink"
                aria-label={intl.formatMessage({ id: 'builder.conditionOp' })}
                value={question.condition.op}
                onChange={(event) =>
                  patch({
                    condition: {
                      ...question.condition!,
                      op: event.currentTarget.value as Condition['op'],
                    },
                  })
                }
              >
                {(['equals', 'in', 'gte', 'lte'] as const).map((op) => (
                  <option key={op} value={op}>
                    {intl.formatMessage({ id: `builder.op.${op}` })}
                  </option>
                ))}
              </select>
              {conditionTarget?.options ? (
                <select
                  className="rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink"
                  aria-label={intl.formatMessage({ id: 'builder.conditionValue' })}
                  value={String(question.condition.value)}
                  onChange={(event) =>
                    patch({
                      condition: { ...question.condition!, value: event.currentTarget.value },
                    })
                  }
                >
                  {conditionTarget.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {earlierTextOf(conditionTarget.id)?.options?.[option.id] || option.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  className="w-20 rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink"
                  aria-label={intl.formatMessage({ id: 'builder.conditionValue' })}
                  value={Number(question.condition.value) || 0}
                  onChange={(event) =>
                    patch({
                      condition: {
                        ...question.condition!,
                        value: Number(event.currentTarget.value),
                      },
                    })
                  }
                />
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
