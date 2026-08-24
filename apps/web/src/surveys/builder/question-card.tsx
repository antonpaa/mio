import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  BODY_REGIONS,
  isSafePattern,
  type Condition,
  type LocaleBundle,
  type Question,
  type QuestionRule,
  type RuleWhen,
} from '@mio/survey-schema';
import { Button } from '@mio/ui';

/**
 * One question in the editor (B2), with validation config (B6), the
 * visibility condition (B5), single-response rules (B2/B3) and nested
 * follow-ups. The card mutates a DRAFT copy through the callbacks; the
 * page owns state and saving.
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
  nextRuleId,
  seriesCatalog,
  dateQuestions,
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
  /** mints a fresh rule id, unique across the whole survey */
  nextRuleId: () => string;
  /** X8: the value-series catalog the binding select offers */
  seriesCatalog: { key: string; name: string; unit: string | null }[];
  /** date questions anywhere in the definition, for measured-at sourcing */
  dateQuestions: { id: string; label: string }[];
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
              // rules are typed against the answer - a changed type starts clean
              if (type !== question.type) delete next.rules;
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
                onPress={() => {
                  // rules referencing the removed option go with it
                  const rules = (question.rules ?? []).filter(
                    (rule) => !(rule.when.kind === 'option' && rule.when.optionId === option.id),
                  );
                  patch({
                    options: options.filter((_, i) => i !== index),
                    rules: rules.length > 0 ? rules : undefined,
                  });
                }}
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

      {(question.type === 'number' || question.type === 'scale') && seriesCatalog.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-xs font-medium text-secondary">
            <FormattedMessage id="builder.valueSeries" />
            <select
              className={`${smallInput} w-52`}
              value={question.valueBinding?.seriesKey ?? ''}
              onChange={(event) => {
                const key = event.currentTarget.value;
                patch({
                  valueBinding:
                    key === ''
                      ? undefined
                      : clean({
                          seriesKey: key,
                          dateQuestionId: question.valueBinding?.dateQuestionId,
                        }),
                });
              }}
            >
              <option value="">{intl.formatMessage({ id: 'builder.valueSeriesNone' })}</option>
              {seriesCatalog.map((series) => (
                <option key={series.key} value={series.key}>
                  {series.name}
                  {series.unit !== null && series.unit !== '' ? ` (${series.unit})` : ''}
                </option>
              ))}
            </select>
          </label>
          {question.valueBinding !== undefined && dateQuestions.length > 0 ? (
            <label className="block text-xs font-medium text-secondary">
              <FormattedMessage id="builder.valueDate" />
              <select
                className={`${smallInput} w-52`}
                value={question.valueBinding.dateQuestionId ?? ''}
                onChange={(event) =>
                  patch({
                    valueBinding: clean({
                      seriesKey: question.valueBinding!.seriesKey,
                      dateQuestionId: event.currentTarget.value || undefined,
                    }),
                  })
                }
              >
                <option value="">{intl.formatMessage({ id: 'builder.valueDateSubmit' })}</option>
                {dateQuestions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
                      // no critical set left -> critical-area rules are moot
                      const rules =
                        next.length > 0
                          ? question.rules
                          : question.rules?.filter((rule) => rule.when.kind !== 'critical_region');
                      patch({
                        criticalRegions: next.length > 0 ? next : undefined,
                        rules: rules && rules.length > 0 ? rules : undefined,
                      });
                    }}
                  />
                  {intl.formatMessage({ id: `bodymap.region.${region.id}` })}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {question.type === 'choice_single' ||
      question.type === 'choice_multi' ||
      question.type === 'number' ||
      question.type === 'scale' ||
      question.type === 'body_map' ? (
        <RulesPanel
          question={question}
          text={text}
          nextRuleId={nextRuleId}
          onChange={(rules) => patch({ rules: rules.length > 0 ? rules : undefined })}
        />
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

const OUTCOME_CHOICES = ['high', 'moderate', 'low', 'record'] as const;
type OutcomeChoice = (typeof OUTCOME_CHOICES)[number];

function outcomeChoiceOf(rule: QuestionRule): OutcomeChoice {
  const alert = rule.outcomes.find((outcome) => outcome.kind === 'alert');
  return alert ? alert.severity : 'record';
}

function outcomesFor(choice: OutcomeChoice): QuestionRule['outcomes'] {
  return choice === 'record' ? [] : [{ kind: 'alert', severity: choice }];
}

/**
 * The B2/B3 rules panel: single-response conditions on THIS question's
 * answer, graded High / Moderate / Low - or "Record only", which stores
 * the firing for trends and raises nothing. Patients never see any of
 * this; the note says so where rules are authored.
 */
function RulesPanel({
  question,
  text,
  nextRuleId,
  onChange,
}: {
  question: Question;
  text: QuestionText | undefined;
  nextRuleId: () => string;
  onChange: (rules: QuestionRule[]) => void;
}): ReactElement {
  const intl = useIntl();
  const rules = question.rules ?? [];
  const selectClass = 'rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink';

  const patchRule = (index: number, when: RuleWhen | null, choice?: OutcomeChoice): void => {
    onChange(
      rules.map((rule, i) =>
        i === index
          ? {
              ...rule,
              when: when ?? rule.when,
              outcomes: choice === undefined ? rule.outcomes : outcomesFor(choice),
            }
          : rule,
      ),
    );
  };

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        <FormattedMessage id="builder.rules" />
      </p>
      <p className="mt-0.5 text-xs text-muted">
        <FormattedMessage id="builder.rulesNote" />
      </p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {rules.map((rule, index) => (
          <div key={rule.id} className="flex flex-wrap items-center gap-2">
            <span className="max-w-32 truncate font-mono text-xs text-muted" title={rule.id}>
              {rule.id}
            </span>
            <WhenEditor
              question={question}
              text={text}
              ruleId={rule.id}
              when={rule.when}
              onChange={(when) => patchRule(index, when)}
            />
            <span aria-hidden className="text-muted">
              →
            </span>
            <select
              className={selectClass}
              aria-label={intl.formatMessage({ id: 'builder.ruleOutcomeLabel' }, { id: rule.id })}
              value={outcomeChoiceOf(rule)}
              onChange={(event) =>
                patchRule(index, null, event.currentTarget.value as OutcomeChoice)
              }
            >
              {OUTCOME_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {intl.formatMessage({ id: `builder.ruleOutcome.${choice}` })}
                </option>
              ))}
            </select>
            <Button
              variant="quiet"
              size="sm"
              onPress={() => onChange(rules.filter((_, i) => i !== index))}
            >
              <FormattedMessage id="schedule.removePhase" />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-1.5">
        <Button
          variant="quiet"
          size="sm"
          onPress={() =>
            onChange([
              ...rules,
              {
                id: nextRuleId(),
                when: defaultWhenFor(question),
                outcomes: [{ kind: 'alert', severity: 'moderate' }],
              },
            ])
          }
        >
          <FormattedMessage id="builder.addRule" />
        </Button>
      </div>
    </div>
  );
}

/** A sensible starting condition per question type. */
export function defaultWhenFor(question: Question): RuleWhen {
  if (question.type === 'choice_single' || question.type === 'choice_multi') {
    return { kind: 'option', optionId: question.options?.[0]?.id ?? 'o-1' };
  }
  if (question.type === 'scale') {
    return { kind: 'at_least', value: question.scale?.max ?? 10 };
  }
  if (question.type === 'number') return { kind: 'at_least', value: 1 };
  return (question.criticalRegions?.length ?? 0) > 0
    ? { kind: 'critical_region' }
    : { kind: 'region_count', value: 3 };
}

/**
 * The single-response condition editor, typed to its question - shared
 * by the per-question rules panel (B2/B3) and the trend rules' repeat
 * match (B7).
 */
export function WhenEditor({
  question,
  text,
  ruleId,
  when,
  onChange,
}: {
  question: Question;
  text: QuestionText | undefined;
  ruleId: string;
  when: RuleWhen;
  onChange: (when: RuleWhen) => void;
}): ReactElement | null {
  const intl = useIntl();
  const selectClass = 'rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink';
  if (when.kind === 'option') {
    return (
      <>
        <span className="text-sm text-secondary">
          <FormattedMessage id="builder.whenAnswer" />
        </span>
        <select
          className={selectClass}
          aria-label={intl.formatMessage({ id: 'builder.ruleConditionLabel' }, { id: ruleId })}
          value={when.optionId}
          onChange={(event) => onChange({ kind: 'option', optionId: event.currentTarget.value })}
        >
          {(question.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {text?.options?.[option.id] || option.id}
            </option>
          ))}
        </select>
      </>
    );
  }
  if (when.kind === 'at_least' || when.kind === 'at_most') {
    return (
      <>
        <span className="text-sm text-secondary">
          <FormattedMessage id="builder.whenValue" />
        </span>
        <select
          className={selectClass}
          aria-label={intl.formatMessage({ id: 'builder.ruleOpLabel' }, { id: ruleId })}
          value={when.kind}
          onChange={(event) =>
            onChange({
              kind: event.currentTarget.value as 'at_least' | 'at_most',
              value: when.value,
            })
          }
        >
          <option value="at_least">{intl.formatMessage({ id: 'builder.op.gte' })}</option>
          <option value="at_most">{intl.formatMessage({ id: 'builder.op.lte' })}</option>
        </select>
        <input
          type="number"
          className={`${selectClass} w-20`}
          aria-label={intl.formatMessage({ id: 'builder.ruleValueLabel' }, { id: ruleId })}
          value={when.value}
          onChange={(event) =>
            onChange({ kind: when.kind, value: Number(event.currentTarget.value) })
          }
        />
      </>
    );
  }
  if (
    when.kind === 'critical_region' ||
    when.kind === 'other_region' ||
    when.kind === 'region_count'
  ) {
    return (
      <>
        <select
          className={selectClass}
          aria-label={intl.formatMessage({ id: 'builder.ruleConditionLabel' }, { id: ruleId })}
          value={when.kind}
          onChange={(event) => {
            const kind = event.currentTarget.value as
              'critical_region' | 'other_region' | 'region_count';
            onChange(kind === 'region_count' ? { kind, value: 3 } : { kind });
          }}
        >
          <option value="critical_region">
            {intl.formatMessage({ id: 'builder.bodyRule.critical_region' })}
          </option>
          <option value="other_region">
            {intl.formatMessage({ id: 'builder.bodyRule.other_region' })}
          </option>
          <option value="region_count">
            {intl.formatMessage({ id: 'builder.bodyRule.region_count' })}
          </option>
        </select>
        {when.kind === 'region_count' ? (
          <input
            type="number"
            min={1}
            className={`${selectClass} w-20`}
            aria-label={intl.formatMessage({ id: 'builder.ruleValueLabel' }, { id: ruleId })}
            value={when.value}
            onChange={(event) =>
              onChange({ kind: 'region_count', value: Number(event.currentTarget.value) })
            }
          />
        ) : null}
      </>
    );
  }
  return null;
}
