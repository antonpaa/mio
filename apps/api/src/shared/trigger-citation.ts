import type { LocaleBundle, RuleTrace } from '@mio/survey-schema';

/**
 * Render a trigger citation from its trace. Question and option labels
 * are SURVEY CONTENT in the response's own locale (never react-intl);
 * body-map region ids stay ids - the client localises region vocabulary.
 * Trend conditions carry the window length so the citation can say
 * "3 occurrences in a row".
 */
export function citeTrigger(
  trace: RuleTrace,
  locales: LocaleBundle[],
  responseLocale: string,
): {
  questionLabel: string;
  kind: RuleTrace['condition']['kind'];
  valueLabel?: string;
  threshold?: number;
  observed?: unknown;
  regions?: string[];
  times?: number;
} {
  const bundle =
    locales.find((entry) => entry.locale === responseLocale) ??
    locales.find((entry) => entry.locale === 'en') ??
    locales[0];
  const text = trace.questionId === null ? undefined : bundle?.questions[trace.questionId];
  const questionLabel = text?.label?.trim() ? text.label : (trace.questionId ?? '');
  const condition = trace.condition;
  switch (condition.kind) {
    case 'option': {
      const optionLabel = text?.options?.[condition.optionId] ?? condition.optionId;
      return { questionLabel, kind: condition.kind, valueLabel: optionLabel };
    }
    case 'at_least':
    case 'at_most':
      return {
        questionLabel,
        kind: condition.kind,
        threshold: condition.value,
        observed: trace.observed,
      };
    case 'critical_region':
    case 'other_region':
    case 'region_count':
      return { questionLabel, kind: condition.kind, regions: trace.matched ?? [] };
    case 'repeat': {
      const match = condition.match;
      const valueLabel =
        match.kind === 'option'
          ? (text?.options?.[match.optionId] ?? match.optionId)
          : 'value' in match
            ? String(match.value)
            : undefined;
      return {
        questionLabel,
        kind: condition.kind,
        times: condition.times,
        ...(valueLabel !== undefined ? { valueLabel } : {}),
      };
    }
    case 'decreasing':
    case 'increasing':
      return {
        questionLabel,
        kind: condition.kind,
        times: condition.times,
        observed: trace.observed,
      };
    case 'missed':
      return { questionLabel: '', kind: condition.kind, times: condition.times };
  }
}
