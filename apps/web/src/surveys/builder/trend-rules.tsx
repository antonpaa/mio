import type { ReactElement } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type {
  LocaleBundle,
  NotifyRecipient,
  Question,
  RuleOutcome,
  Severity,
  TrendRule,
  TrendWhen,
} from '@mio/survey-schema';
import { Button } from '@mio/ui';
import { defaultWhenFor, WhenEditor, type QuestionText } from './question-card.js';

/**
 * B7: the trend rules panel - survey-level conditions over CONSECUTIVE
 * occurrences, with outcomes in any combination: a graded alert, a
 * custom notification delivered as written (in-app only), a task in the
 * team queue - or none of them, which records the pattern and raises
 * nothing. Authored texts are per-locale content and live in the
 * bundles, edited here in the active language like every other text.
 */

const selectClass = 'rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink';
const RULE_ELIGIBLE = ['choice_single', 'choice_multi', 'number', 'scale', 'body_map'];

function alertChoiceOf(rule: TrendRule): Severity | 'none' {
  const alert = rule.outcomes.find((outcome) => outcome.kind === 'alert');
  return alert && alert.kind === 'alert' ? alert.severity : 'none';
}

function withOutcome(
  outcomes: RuleOutcome[],
  kind: RuleOutcome['kind'],
  next: RuleOutcome | null,
): RuleOutcome[] {
  const kept = outcomes.filter((outcome) => outcome.kind !== kind);
  return next === null ? kept : [...kept, next];
}

export function TrendRulesPanel({
  questions,
  rules,
  bundle,
  nextRuleId,
  onChangeRules,
  onChangeRuleText,
}: {
  /** every question in traversal order (condition targets) */
  questions: Question[];
  rules: TrendRule[];
  /** the ACTIVE locale's bundle - authored texts edit in this language */
  bundle: LocaleBundle;
  nextRuleId: () => string;
  onChangeRules: (rules: TrendRule[]) => void;
  onChangeRuleText: (
    ruleId: string,
    patch: {
      notifyTexts?: Partial<Record<NotifyRecipient, string>>;
      taskTitle?: string;
    },
  ) => void;
}): ReactElement {
  const intl = useIntl();
  const eligible = questions.filter((question) => RULE_ELIGIBLE.includes(question.type));
  const numeric = questions.filter(
    (question) => question.type === 'number' || question.type === 'scale',
  );
  const labelOf = (question: Question): string =>
    bundle.questions[question.id]?.label || question.id;

  const patch = (index: number, partial: Partial<TrendRule>): void =>
    onChangeRules(rules.map((rule, i) => (i === index ? { ...rule, ...partial } : rule)));

  const kindChanged = (index: number, kind: TrendWhen['kind']): void => {
    const times = rules[index]!.when.times;
    if (kind === 'missed') {
      patch(index, { when: { kind, times: Math.max(times, 1) } });
      return;
    }
    if (kind === 'decreasing' || kind === 'increasing') {
      const target = numeric[0];
      if (!target) return;
      patch(index, { when: { kind, questionId: target.id, times: Math.max(times, 2) } });
      return;
    }
    const target = eligible[0];
    if (!target) return;
    patch(index, {
      when: {
        kind: 'repeat',
        questionId: target.id,
        match: defaultWhenFor(target),
        times: Math.max(times, 2),
      },
    });
  };

  return (
    <section
      aria-labelledby="trend-rules-title"
      className="rounded-card border border-black/5 bg-surface p-5 shadow-resting"
    >
      <h2 id="trend-rules-title" className="text-xs font-medium uppercase tracking-wide text-muted">
        <FormattedMessage id="builder.trendRules" />
      </h2>
      <p className="mt-0.5 text-xs text-muted">
        <FormattedMessage id="builder.trendRulesNote" />
      </p>

      <div className="mt-2 flex flex-col gap-3">
        {rules.map((rule, index) => {
          const when = rule.when;
          const question =
            when.kind === 'missed'
              ? undefined
              : questions.find((entry) => entry.id === when.questionId);
          const text: QuestionText | undefined =
            question === undefined ? undefined : bundle.questions[question.id];
          const notify = rule.outcomes.find((outcome) => outcome.kind === 'notify');
          const task = rule.outcomes.some((outcome) => outcome.kind === 'task');
          const ruleText = bundle.rules?.[rule.id];
          return (
            <div key={rule.id} className="rounded-inner border border-hairline p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="max-w-32 truncate font-mono text-xs text-muted" title={rule.id}>
                  {rule.id}
                </span>
                <select
                  className={selectClass}
                  aria-label={intl.formatMessage({ id: 'builder.trendKindLabel' }, { id: rule.id })}
                  value={when.kind}
                  onChange={(event) =>
                    kindChanged(index, event.currentTarget.value as TrendWhen['kind'])
                  }
                >
                  <option value="repeat" disabled={eligible.length === 0}>
                    {intl.formatMessage({ id: 'builder.trendKind.repeat' })}
                  </option>
                  <option value="decreasing" disabled={numeric.length === 0}>
                    {intl.formatMessage({ id: 'builder.trendKind.decreasing' })}
                  </option>
                  <option value="increasing" disabled={numeric.length === 0}>
                    {intl.formatMessage({ id: 'builder.trendKind.increasing' })}
                  </option>
                  <option value="missed">
                    {intl.formatMessage({ id: 'builder.trendKind.missed' })}
                  </option>
                </select>
                {when.kind !== 'missed' ? (
                  <select
                    className={selectClass}
                    aria-label={intl.formatMessage(
                      { id: 'builder.trendQuestionLabel' },
                      { id: rule.id },
                    )}
                    value={when.questionId}
                    onChange={(event) => {
                      const target = questions.find(
                        (entry) => entry.id === event.currentTarget.value,
                      );
                      if (!target) return;
                      patch(index, {
                        when:
                          when.kind === 'repeat'
                            ? { ...when, questionId: target.id, match: defaultWhenFor(target) }
                            : { ...when, questionId: target.id },
                      });
                    }}
                  >
                    {(when.kind === 'repeat' ? eligible : numeric).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {labelOf(entry)}
                      </option>
                    ))}
                  </select>
                ) : null}
                {when.kind === 'repeat' && question !== undefined ? (
                  <WhenEditor
                    question={question}
                    text={text}
                    ruleId={rule.id}
                    when={when.match}
                    onChange={(match) => patch(index, { when: { ...when, match } })}
                  />
                ) : null}
                <input
                  type="number"
                  min={when.kind === 'missed' ? 1 : 2}
                  max={12}
                  className={`${selectClass} w-16`}
                  aria-label={intl.formatMessage(
                    { id: 'builder.trendTimesLabel' },
                    { id: rule.id },
                  )}
                  value={when.times}
                  onChange={(event) =>
                    patch(index, {
                      when: { ...when, times: Number(event.currentTarget.value) },
                    })
                  }
                />
                <span className="text-sm text-secondary">
                  <FormattedMessage id="builder.trendTimesSuffix" />
                </span>
                <div className="ml-auto">
                  <Button
                    variant="quiet"
                    size="sm"
                    onPress={() => onChangeRules(rules.filter((_, i) => i !== index))}
                  >
                    <FormattedMessage id="schedule.removePhase" />
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-2">
                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <FormattedMessage id="builder.outcomeAlert" />
                  <select
                    className={selectClass}
                    aria-label={intl.formatMessage(
                      { id: 'builder.ruleOutcomeLabel' },
                      { id: rule.id },
                    )}
                    value={alertChoiceOf(rule)}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      patch(index, {
                        outcomes: withOutcome(
                          rule.outcomes,
                          'alert',
                          value === 'none' ? null : { kind: 'alert', severity: value as Severity },
                        ),
                      });
                    }}
                  >
                    <option value="none">
                      {intl.formatMessage({ id: 'builder.outcomeAlert.none' })}
                    </option>
                    {(['high', 'moderate', 'low'] as const).map((severity) => (
                      <option key={severity} value={severity}>
                        {intl.formatMessage({ id: `severity.${severity}` })}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={notify !== undefined}
                    onChange={(event) =>
                      patch(index, {
                        outcomes: withOutcome(
                          rule.outcomes,
                          'notify',
                          event.currentTarget.checked
                            ? { kind: 'notify', recipients: ['team'] }
                            : null,
                        ),
                      })
                    }
                  />
                  <FormattedMessage id="builder.outcomeNotify" />
                </label>
                {notify !== undefined && notify.kind === 'notify' ? (
                  <>
                    {(['team', 'lead', 'patient'] as const).map((recipient) => (
                      <label
                        key={recipient}
                        className="flex items-center gap-1 text-xs text-secondary"
                      >
                        <input
                          type="checkbox"
                          checked={notify.recipients.includes(recipient)}
                          onChange={(event) => {
                            const recipients: NotifyRecipient[] = event.currentTarget.checked
                              ? [...notify.recipients, recipient]
                              : notify.recipients.filter((entry) => entry !== recipient);
                            patch(index, {
                              outcomes: withOutcome(
                                rule.outcomes,
                                'notify',
                                recipients.length > 0 ? { kind: 'notify', recipients } : null,
                              ),
                            });
                          }}
                        />
                        {intl.formatMessage({ id: `builder.recipient.${recipient}` })}
                      </label>
                    ))}
                    {/* X13: each audience reads its own copy - one field
                        per selected recipient, legacy single text as the
                        prefill so pre-X13 drafts surface what still ships */}
                    <div className="flex w-full flex-col gap-1.5">
                      {(['team', 'lead', 'patient'] as const)
                        .filter((recipient) => notify.recipients.includes(recipient))
                        .map((recipient) => (
                          <label
                            key={recipient}
                            className="flex items-center gap-2 text-xs text-secondary"
                          >
                            <span className="w-28 shrink-0 text-right">
                              {intl.formatMessage({ id: `builder.recipient.${recipient}` })}
                            </span>
                            <input
                              className={`${selectClass} min-w-56 flex-1`}
                              aria-label={intl.formatMessage(
                                { id: 'builder.notifyTextLabelFor' },
                                {
                                  id: rule.id,
                                  recipient: intl.formatMessage({
                                    id: `builder.recipient.${recipient}`,
                                  }),
                                },
                              )}
                              placeholder={intl.formatMessage({
                                id: 'builder.notifyTextPlaceholder',
                              })}
                              value={
                                ruleText?.notifyTexts?.[recipient] ?? ruleText?.notifyText ?? ''
                              }
                              onChange={(event) =>
                                onChangeRuleText(rule.id, {
                                  notifyTexts: {
                                    ...(ruleText?.notifyTexts ?? {}),
                                    [recipient]: event.currentTarget.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                    </div>
                  </>
                ) : null}

                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={task}
                    onChange={(event) =>
                      patch(index, {
                        outcomes: withOutcome(
                          rule.outcomes,
                          'task',
                          event.currentTarget.checked ? { kind: 'task' } : null,
                        ),
                      })
                    }
                  />
                  <FormattedMessage id="builder.outcomeTask" />
                </label>
                {task ? (
                  <input
                    className={`${selectClass} min-w-40`}
                    aria-label={intl.formatMessage(
                      { id: 'builder.taskTitleLabel' },
                      { id: rule.id },
                    )}
                    placeholder={intl.formatMessage({ id: 'builder.taskTitlePlaceholder' })}
                    value={ruleText?.taskTitle ?? ''}
                    onChange={(event) =>
                      onChangeRuleText(rule.id, { taskTitle: event.currentTarget.value })
                    }
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2">
        <Button
          variant="quiet"
          size="sm"
          onPress={() =>
            onChangeRules([
              ...rules,
              {
                id: nextRuleId(),
                when: { kind: 'missed', times: 2 },
                outcomes: [{ kind: 'alert', severity: 'moderate' }],
              },
            ])
          }
        >
          <FormattedMessage id="builder.addTrendRule" />
        </Button>
      </div>
    </section>
  );
}
