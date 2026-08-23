import { allQuestions } from './engine.js';
import type { Question, QuestionRule, SurveyDefinition, TrendRule } from './types.js';

/**
 * Program-specific rule layering (docs/architecture/surveys-and-alerts.md,
 * WP-22): template rules are defaults; attaching a survey to a treatment
 * may override thresholds, option targets, trend windows and the critical
 * body-map set - "what counts as expected vs alarming can be adjusted per
 * treatment program", and the same answers behave differently in another
 * program. The EFFECTIVE rule set is template + overrides, resolved here;
 * evaluation and the trace layer never know about storage, they just see
 * rules whose `source` says which layer supplied them.
 */

export interface ProgramOverrides {
  /** rule id -> parameter replacement; `disabled` removes the rule from
   * the effective set entirely */
  rules?: Record<string, { value?: number; optionId?: string; times?: number; disabled?: boolean }>;
  /** body-map question id -> the program's critical region set */
  criticalRegions?: Record<string, string[]>;
}

function overrideQuestionRule(
  rule: QuestionRule,
  patch: NonNullable<ProgramOverrides['rules']>[string],
): QuestionRule | null {
  if (patch.disabled === true) return null;
  const when = { ...rule.when };
  let changed = false;
  if (patch.value !== undefined && 'value' in when && typeof when.value === 'number') {
    when.value = patch.value;
    changed = true;
  }
  if (patch.optionId !== undefined && when.kind === 'option') {
    when.optionId = patch.optionId;
    changed = true;
  }
  if (!changed) return rule;
  return { ...rule, when, source: 'program' };
}

function overrideTrendRule(
  rule: TrendRule,
  patch: NonNullable<ProgramOverrides['rules']>[string],
): TrendRule | null {
  if (patch.disabled === true) return null;
  const when = { ...rule.when };
  let changed = false;
  if (patch.times !== undefined) {
    when.times = patch.times;
    changed = true;
  }
  if (when.kind === 'repeat') {
    const match = { ...when.match };
    if (patch.value !== undefined && 'value' in match && typeof match.value === 'number') {
      match.value = patch.value;
      changed = true;
    }
    if (patch.optionId !== undefined && match.kind === 'option') {
      match.optionId = patch.optionId;
      changed = true;
    }
    when.match = match;
  }
  if (!changed) return rule;
  return { ...rule, when, source: 'program' };
}

/**
 * Resolve the effective definition for ONE treatment. Pure and
 * non-mutating; with empty overrides the template definition comes back
 * untouched. A replaced critical set marks that question's region rules
 * as program-sourced - their meaning changed even though their shape did
 * not.
 */
export function applyOverrides(
  definition: SurveyDefinition,
  overrides: ProgramOverrides,
): SurveyDefinition {
  const rulePatches = overrides.rules ?? {};
  const regionPatches = overrides.criticalRegions ?? {};
  if (Object.keys(rulePatches).length === 0 && Object.keys(regionPatches).length === 0) {
    return definition;
  }
  const mapQuestion = (question: Question): Question => {
    const next: Question = { ...question };
    const regions = regionPatches[question.id];
    const regionsChanged = regions !== undefined && question.type === 'body_map';
    if (regionsChanged) {
      if (regions.length > 0) next.criticalRegions = regions;
      else delete next.criticalRegions;
    }
    if (question.rules !== undefined) {
      const rules = question.rules
        .map((rule) => {
          const patched = rulePatches[rule.id]
            ? overrideQuestionRule(rule, rulePatches[rule.id]!)
            : rule;
          if (patched === null) return null;
          const regionKinds = ['critical_region', 'other_region', 'region_count'];
          if (regionsChanged && regionKinds.includes(patched.when.kind)) {
            return { ...patched, source: 'program' as const };
          }
          return patched;
        })
        .filter((rule): rule is QuestionRule => rule !== null);
      if (rules.length > 0) next.rules = rules;
      else delete next.rules;
    }
    if (question.followUps !== undefined) next.followUps = question.followUps.map(mapQuestion);
    return next;
  };
  const next: SurveyDefinition = {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      questions: page.questions.map(mapQuestion),
    })),
  };
  if (definition.trendRules !== undefined) {
    const trendRules = definition.trendRules
      .map((rule) => (rulePatches[rule.id] ? overrideTrendRule(rule, rulePatches[rule.id]!) : rule))
      .filter((rule): rule is TrendRule => rule !== null);
    if (trendRules.length > 0) next.trendRules = trendRules;
    else delete next.trendRules;
  }
  return next;
}

export type OverrideIssue =
  | { code: 'unknown_rule'; ruleId: string }
  | { code: 'bad_patch'; ruleId: string }
  | { code: 'unknown_question'; questionId: string }
  | { code: 'bad_regions'; questionId: string };

/** Shape-check overrides against the version they layer onto - and prove
 * the result still validates as a definition would. */
export function validateOverrides(
  definition: SurveyDefinition,
  overrides: ProgramOverrides,
  regionIds: ReadonlySet<string>,
): OverrideIssue[] {
  const issues: OverrideIssue[] = [];
  const questions = allQuestions(definition);
  const questionRules = new Map(
    questions.flatMap((question) => (question.rules ?? []).map((rule) => [rule.id, rule] as const)),
  );
  const trendRules = new Map((definition.trendRules ?? []).map((rule) => [rule.id, rule]));
  for (const [ruleId, patch] of Object.entries(overrides.rules ?? {})) {
    const questionRule = questionRules.get(ruleId);
    const trendRule = trendRules.get(ruleId);
    if (questionRule === undefined && trendRule === undefined) {
      issues.push({ code: 'unknown_rule', ruleId });
      continue;
    }
    if (patch.disabled === true) continue;
    if (
      patch.value !== undefined &&
      (typeof patch.value !== 'number' || !Number.isFinite(patch.value))
    ) {
      issues.push({ code: 'bad_patch', ruleId });
      continue;
    }
    if (patch.times !== undefined) {
      if (
        trendRule === undefined ||
        !Number.isInteger(patch.times) ||
        patch.times < 1 ||
        patch.times > 12
      ) {
        issues.push({ code: 'bad_patch', ruleId });
        continue;
      }
    }
    if (patch.optionId !== undefined) {
      const when =
        questionRule?.when ??
        (trendRule?.when.kind === 'repeat' ? trendRule.when.match : undefined);
      if (when === undefined || when.kind !== 'option') {
        issues.push({ code: 'bad_patch', ruleId });
        continue;
      }
      const owner = questions.find(
        (question) =>
          (question.rules ?? []).some((rule) => rule.id === ruleId) ||
          (trendRule?.when.kind === 'repeat' && trendRule.when.questionId === question.id),
      );
      if (!(owner?.options ?? []).some((option) => option.id === patch.optionId)) {
        issues.push({ code: 'bad_patch', ruleId });
      }
    }
  }
  for (const [questionId, regions] of Object.entries(overrides.criticalRegions ?? {})) {
    const question = questions.find((entry) => entry.id === questionId);
    if (question === undefined || question.type !== 'body_map') {
      issues.push({ code: 'unknown_question', questionId });
      continue;
    }
    if (!Array.isArray(regions) || regions.some((region) => !regionIds.has(region))) {
      issues.push({ code: 'bad_regions', questionId });
    }
  }
  return issues;
}
