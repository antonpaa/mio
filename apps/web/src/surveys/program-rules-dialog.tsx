import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl';
import {
  allQuestions,
  BODY_REGIONS,
  type LocaleBundle,
  type ProgramOverrides,
  type Question,
  type SurveyDefinition,
  type TrendRule,
} from '@mio/survey-schema';
import { Button, ErrorState, Skeleton, StatusChip, useModalFocus } from '@mio/ui';

/**
 * The program rules panel (WP-22): template rules are defaults; THIS
 * treatment may tighten thresholds, re-time trend windows, disable rules
 * or replace the critical body-map set. Overridden rows carry a Program
 * badge; everything else reads straight from the template. Treatment
 * Lead capability - the server decides, this dialog just renders the
 * refusal if a non-lead reaches it.
 */

interface RulesPayload {
  versionId: string;
  version: number;
  definition: SurveyDefinition;
  locales: LocaleBundle[];
  overrides: ProgramOverrides;
}

const inputClass = 'rounded-inner border border-border bg-surface px-2 py-1 text-sm text-ink';

interface FlatRule {
  id: string;
  questionId: string | null;
  kind: string;
  templateValue: number | null;
  templateTimes: number | null;
  optionId: string | null;
}

function flattenRules(definition: SurveyDefinition): FlatRule[] {
  const out: FlatRule[] = [];
  for (const question of allQuestions(definition)) {
    for (const rule of question.rules ?? []) {
      out.push({
        id: rule.id,
        questionId: question.id,
        kind: rule.when.kind,
        templateValue: 'value' in rule.when ? rule.when.value : null,
        templateTimes: null,
        optionId: rule.when.kind === 'option' ? rule.when.optionId : null,
      });
    }
  }
  for (const rule of definition.trendRules ?? []) {
    const trend: TrendRule = rule;
    out.push({
      id: trend.id,
      questionId: 'questionId' in trend.when ? trend.when.questionId : null,
      kind: trend.when.kind,
      templateValue:
        trend.when.kind === 'repeat' && 'value' in trend.when.match ? trend.when.match.value : null,
      templateTimes: trend.when.times,
      optionId:
        trend.when.kind === 'repeat' && trend.when.match.kind === 'option'
          ? trend.when.match.optionId
          : null,
    });
  }
  return out;
}

function conditionSummary(
  intl: IntlShape,
  rule: FlatRule,
  bundle: LocaleBundle | undefined,
): string {
  const optionLabel =
    rule.optionId !== null && rule.questionId !== null
      ? (bundle?.questions[rule.questionId]?.options?.[rule.optionId] ?? rule.optionId)
      : '';
  switch (rule.kind) {
    case 'option':
      return intl.formatMessage({ id: 'rules.cond.option' }, { value: optionLabel });
    case 'at_least':
      return intl.formatMessage({ id: 'rules.cond.at_least' });
    case 'at_most':
      return intl.formatMessage({ id: 'rules.cond.at_most' });
    case 'critical_region':
      return intl.formatMessage({ id: 'builder.bodyRule.critical_region' });
    case 'other_region':
      return intl.formatMessage({ id: 'builder.bodyRule.other_region' });
    case 'region_count':
      return intl.formatMessage({ id: 'builder.bodyRule.region_count' });
    case 'repeat':
      return intl.formatMessage({ id: 'rules.cond.repeat' }, { value: optionLabel });
    case 'decreasing':
      return intl.formatMessage({ id: 'builder.trendKind.decreasing' });
    case 'increasing':
      return intl.formatMessage({ id: 'builder.trendKind.increasing' });
    case 'missed':
      return intl.formatMessage({ id: 'builder.trendKind.missed' });
    default:
      return rule.kind;
  }
}

export function ProgramRulesDialog({
  treatmentId,
  surveyId,
  surveyName,
  onClose,
}: {
  treatmentId: string;
  surveyId: string;
  surveyName: string;
  onClose: () => void;
}): ReactElement {
  const modalRef = useModalFocus<HTMLDivElement>();
  const intl = useIntl();
  const queryClient = useQueryClient();
  // edits overlay the loaded overrides; until the first edit the loaded
  // state IS the draft, so no effect-driven state sync is needed
  const [edits, setEdits] = useState<ProgramOverrides | null>(null);

  const payload = useQuery({
    queryKey: ['program-rules', treatmentId, surveyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/staff/treatments/${treatmentId}/surveys/${surveyId}/rules`,
        { credentials: 'same-origin' },
      );
      if (!response.ok) throw new Error(`rules: ${response.status}`);
      return (await response.json()) as RulesPayload;
    },
    retry: false,
  });
  const draft: ProgramOverrides = edits ?? payload.data?.overrides ?? {};

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/staff/treatments/${treatmentId}/surveys/${surveyId}/rules`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ overrides: draft }),
        },
      );
      if (!response.ok) throw new Error(`save: ${response.status}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['program-rules', treatmentId, surveyId] });
      onClose();
    },
  });

  const patchRule = (
    ruleId: string,
    partial: {
      value?: number | undefined;
      times?: number | undefined;
      disabled?: boolean | undefined;
    },
  ): void => {
    const existing = draft.rules?.[ruleId] ?? {};
    const merged = { ...existing, ...partial };
    const cleaned = Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined && value !== false),
    );
    const rules = { ...draft.rules };
    if (Object.keys(cleaned).length === 0) delete rules[ruleId];
    else rules[ruleId] = cleaned;
    const next: ProgramOverrides = { ...draft };
    if (Object.keys(rules).length > 0) next.rules = rules;
    else delete next.rules;
    setEdits(next);
  };

  const bundleFor = (locale: string): LocaleBundle | undefined =>
    payload.data?.locales.find((entry) => entry.locale === locale) ?? payload.data?.locales[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="program-rules-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        ref={modalRef}
        className="flex max-h-full w-full max-w-2xl flex-col rounded-card bg-surface shadow-raised"
      >
        <header className="border-b border-hairline px-6 py-4">
          <h2 id="program-rules-title" className="font-display text-lg italic text-ink">
            <FormattedMessage id="rules.title" values={{ survey: surveyName }} />
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            <FormattedMessage id="rules.note" />
          </p>
        </header>
        <div className="flex flex-col gap-3 overflow-y-auto px-6 py-5">
          {payload.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : payload.isError ? (
            <ErrorState onRetry={() => void payload.refetch()} />
          ) : (
            <>
              {flattenRules(payload.data.definition).map((rule) => {
                const bundle = bundleFor(intl.locale.slice(0, 2));
                const patch = draft.rules?.[rule.id] ?? {};
                const overridden =
                  patch.value !== undefined || patch.times !== undefined || patch.disabled === true;
                const questionLabel =
                  rule.questionId === null
                    ? intl.formatMessage({ id: 'rules.wholeSurvey' })
                    : bundle?.questions[rule.questionId]?.label || rule.questionId;
                return (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center gap-2 rounded-inner border border-hairline px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {questionLabel}
                      </span>
                      <span className="block text-xs text-secondary">
                        {conditionSummary(intl, rule, bundle)}
                      </span>
                    </span>
                    {rule.templateValue !== null ? (
                      <label className="flex items-center gap-1.5 text-xs text-secondary">
                        <FormattedMessage id="rules.threshold" />
                        <input
                          type="number"
                          className={`${inputClass} w-20`}
                          aria-label={intl.formatMessage(
                            { id: 'builder.ruleValueLabel' },
                            { id: rule.id },
                          )}
                          value={patch.value ?? rule.templateValue}
                          onChange={(event) =>
                            patchRule(rule.id, {
                              value:
                                Number(event.currentTarget.value) === rule.templateValue
                                  ? undefined
                                  : Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    ) : null}
                    {rule.templateTimes !== null ? (
                      <label className="flex items-center gap-1.5 text-xs text-secondary">
                        <FormattedMessage id="rules.times" />
                        <input
                          type="number"
                          min={1}
                          max={12}
                          className={`${inputClass} w-16`}
                          aria-label={intl.formatMessage(
                            { id: 'builder.trendTimesLabel' },
                            { id: rule.id },
                          )}
                          value={patch.times ?? rule.templateTimes}
                          onChange={(event) =>
                            patchRule(rule.id, {
                              times:
                                Number(event.currentTarget.value) === rule.templateTimes
                                  ? undefined
                                  : Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    ) : null}
                    <label className="flex items-center gap-1.5 text-xs text-secondary">
                      <input
                        type="checkbox"
                        checked={patch.disabled === true}
                        onChange={(event) =>
                          patchRule(rule.id, { disabled: event.currentTarget.checked })
                        }
                      />
                      <FormattedMessage id="rules.disable" />
                    </label>
                    <StatusChip tone={overridden ? 'amber' : 'neutral'}>
                      {intl.formatMessage({
                        id: overridden ? 'rules.layer.program' : 'rules.layer.template',
                      })}
                    </StatusChip>
                  </div>
                );
              })}

              {allQuestions(payload.data.definition)
                .filter((question): question is Question => question.type === 'body_map')
                .map((question) => {
                  const bundle = bundleFor(intl.locale.slice(0, 2));
                  const templateSet = question.criticalRegions ?? [];
                  const current = draft.criticalRegions?.[question.id] ?? templateSet;
                  const overridden = draft.criticalRegions?.[question.id] !== undefined;
                  const toggle = (regionId: string): void => {
                    const next = current.includes(regionId)
                      ? current.filter((entry) => entry !== regionId)
                      : [...current, regionId];
                    const sameAsTemplate =
                      next.length === templateSet.length &&
                      next.every((entry) => templateSet.includes(entry));
                    const sets = { ...draft.criticalRegions };
                    if (sameAsTemplate) delete sets[question.id];
                    else sets[question.id] = next;
                    const out: ProgramOverrides = { ...draft };
                    if (Object.keys(sets).length > 0) out.criticalRegions = sets;
                    else delete out.criticalRegions;
                    setEdits(out);
                  };
                  return (
                    <fieldset
                      key={question.id}
                      className="rounded-inner border border-hairline p-3"
                    >
                      <legend className="sr-only">
                        {intl.formatMessage(
                          { id: 'rules.criticalFor' },
                          { question: bundle?.questions[question.id]?.label || question.id },
                        )}
                      </legend>
                      <p
                        aria-hidden
                        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"
                      >
                        ⚑{' '}
                        {intl.formatMessage(
                          { id: 'rules.criticalFor' },
                          { question: bundle?.questions[question.id]?.label || question.id },
                        )}
                        <StatusChip tone={overridden ? 'amber' : 'neutral'}>
                          {intl.formatMessage({
                            id: overridden ? 'rules.layer.program' : 'rules.layer.template',
                          })}
                        </StatusChip>
                      </p>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                        {BODY_REGIONS.map((region) => (
                          <label
                            key={region.id}
                            className="flex items-center gap-2 text-sm text-ink"
                          >
                            <input
                              type="checkbox"
                              checked={current.includes(region.id)}
                              onChange={() => toggle(region.id)}
                            />
                            {intl.formatMessage({ id: `bodymap.region.${region.id}` })}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
            </>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-hairline px-6 py-4">
          <Button variant="quiet" onPress={onClose}>
            <FormattedMessage id="common.cancel" />
          </Button>
          <Button
            isDisabled={save.isPending || payload.isPending}
            onPress={() => void save.mutate()}
          >
            <FormattedMessage id="rules.save" />
          </Button>
        </footer>
      </div>
    </div>
  );
}
