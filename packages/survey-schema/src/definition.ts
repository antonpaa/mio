import { allQuestions } from './engine.js';
import { isSafePattern } from './safe-regex.js';
import { BODY_REGION_IDS } from './body-map.js';
import { isQuestionId } from './ids.js';
import { SEVERITIES } from './rules.js';
import type { LocaleBundle, Question, QuestionRule, SurveyDefinition, TrendRule } from './types.js';

/**
 * Structural validation of a definition - what the builder enforces by
 * construction and the server re-checks before storing a version. A
 * definition that passes here cannot cycle, cannot reference forward, and
 * cannot carry an unsafe pattern.
 */

export interface DefinitionIssue {
  questionId?: string;
  code:
    | 'duplicate_id'
    | 'bad_id'
    | 'missing_options'
    | 'duplicate_option'
    | 'bad_scale'
    | 'bad_bounds'
    | 'unsafe_pattern'
    | 'forward_condition'
    | 'unknown_condition_target'
    | 'unknown_region'
    | 'bad_rule'
    | 'bad_symptom_map'
    | 'bad_value_binding'
    | 'empty';
}

/** B2 keeps rule lists short; the server refuses hand-crafted excess. */
export const MAX_RULES_PER_QUESTION = 10;

export function validateDefinition(definition: SurveyDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const questions = allQuestions(definition);
  if (questions.length === 0) {
    issues.push({ code: 'empty' });
    return issues;
  }
  const seen = new Set<string>();
  const ruleIds = new Set<string>();
  for (const question of questions) {
    if (!isQuestionId(question.id)) issues.push({ questionId: question.id, code: 'bad_id' });
    if (seen.has(question.id)) issues.push({ questionId: question.id, code: 'duplicate_id' });
    seen.add(question.id);
    issues.push(...questionIssues(question, seen));
    // the binding's date source must exist and be a date question - the
    // reference spans the whole definition, so it validates here
    if (
      question.valueBinding?.dateQuestionId !== undefined &&
      !questions.some(
        (candidate) =>
          candidate.id === question.valueBinding?.dateQuestionId && candidate.type === 'date',
      )
    ) {
      issues.push({ questionId: question.id, code: 'bad_value_binding' });
    }
    for (const rule of question.rules ?? []) {
      if (ruleIds.has(rule.id)) issues.push({ questionId: question.id, code: 'bad_rule' });
      ruleIds.add(rule.id);
    }
  }
  // survey-level trend rules share the rule-id namespace, so a trace's
  // (survey_version, rule_id) pair stays unambiguous across both kinds
  const trendRules = definition.trendRules;
  if (trendRules !== undefined) {
    if (!Array.isArray(trendRules) || trendRules.length > MAX_TREND_RULES) {
      issues.push({ code: 'bad_rule' });
    } else {
      const byId = new Map(questions.map((question) => [question.id, question]));
      for (const rule of trendRules) {
        if (ruleIds.has(rule.id) || trendRuleIssue(byId, rule)) {
          issues.push({ questionId: rule.id, code: 'bad_rule' });
        }
        ruleIds.add(rule.id);
      }
    }
  }
  return issues;
}

const NOTIFY_RECIPIENTS = ['team', 'lead', 'patient'];

/** Outcomes: any combination, one of each kind, all fields shape-valid. */
function outcomesIssue(outcomes: QuestionRule['outcomes']): boolean {
  if (!Array.isArray(outcomes) || outcomes.length > 3) return true;
  const kinds = new Set<string>();
  for (const outcome of outcomes) {
    if (kinds.has(outcome.kind)) return true;
    kinds.add(outcome.kind);
    if (outcome.kind === 'alert') {
      if (!SEVERITIES.includes(outcome.severity)) return true;
    } else if (outcome.kind === 'notify') {
      if (
        !Array.isArray(outcome.recipients) ||
        outcome.recipients.length === 0 ||
        outcome.recipients.some((entry) => !NOTIFY_RECIPIENTS.includes(entry)) ||
        new Set(outcome.recipients).size !== outcome.recipients.length
      ) {
        return true;
      }
    } else if (outcome.kind !== 'task') {
      return true;
    }
  }
  return false;
}

function whenMisfits(question: Question, when: QuestionRule['when']): boolean {
  switch (when.kind) {
    case 'option':
      return (
        (question.type !== 'choice_single' && question.type !== 'choice_multi') ||
        !(question.options ?? []).some((option) => option.id === when.optionId)
      );
    case 'at_least':
    case 'at_most':
      return (
        (question.type !== 'number' && question.type !== 'scale') ||
        typeof when.value !== 'number' ||
        !Number.isFinite(when.value)
      );
    case 'critical_region':
      return question.type !== 'body_map' || (question.criticalRegions ?? []).length === 0;
    case 'other_region':
      return question.type !== 'body_map';
    case 'region_count':
      return question.type !== 'body_map' || !Number.isInteger(when.value) || when.value < 1;
    default:
      return true;
  }
}

/** A rule's condition must fit the question it sits on; declarative JSON
 * only - anything shape-invalid is one refusal, not a runtime surprise. */
function ruleIssue(question: Question, rule: QuestionRule): boolean {
  if (!isQuestionId(rule.id)) return true;
  if (outcomesIssue(rule.outcomes)) return true;
  return whenMisfits(question, rule.when);
}

/** Trend windows stay small and typed: repeat needs >= 2 occurrences (one
 * is a single-response rule), monotone runs need >= 2, missed >= 1. */
export const MAX_TREND_TIMES = 12;
export const MAX_TREND_RULES = 20;

function trendRuleIssue(questions: Map<string, Question>, rule: TrendRule): boolean {
  if (!isQuestionId(rule.id)) return true;
  if (outcomesIssue(rule.outcomes)) return true;
  const when = rule.when;
  if (!Number.isInteger(when.times) || when.times > MAX_TREND_TIMES) return true;
  switch (when.kind) {
    case 'missed':
      return when.times < 1;
    case 'repeat': {
      if (when.times < 2) return true;
      const question = questions.get(when.questionId);
      return question === undefined || whenMisfits(question, when.match);
    }
    case 'decreasing':
    case 'increasing': {
      if (when.times < 2) return true;
      const question = questions.get(when.questionId);
      return question === undefined || (question.type !== 'number' && question.type !== 'scale');
    }
    default:
      return true;
  }
}

function questionIssues(question: Question, earlier: Set<string>): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  if (question.type === 'choice_single' || question.type === 'choice_multi') {
    if (!question.options || question.options.length === 0) {
      issues.push({ questionId: question.id, code: 'missing_options' });
    } else {
      const optionIds = new Set<string>();
      for (const option of question.options) {
        if (optionIds.has(option.id) || !isQuestionId(option.id)) {
          issues.push({ questionId: question.id, code: 'duplicate_option' });
        }
        optionIds.add(option.id);
      }
    }
  }
  if (question.type === 'scale') {
    const scale = question.scale;
    if (
      !scale ||
      !Number.isInteger(scale.min) ||
      !Number.isInteger(scale.max) ||
      scale.min >= scale.max ||
      scale.max - scale.min > 100
    ) {
      issues.push({ questionId: question.id, code: 'bad_scale' });
    }
  }
  const validation = question.validation;
  if (validation) {
    if (
      validation.min !== undefined &&
      validation.max !== undefined &&
      validation.min > validation.max
    ) {
      issues.push({ questionId: question.id, code: 'bad_bounds' });
    }
    if (
      validation.decimals !== undefined &&
      (!Number.isInteger(validation.decimals) || validation.decimals < 0 || validation.decimals > 6)
    ) {
      issues.push({ questionId: question.id, code: 'bad_bounds' });
    }
    if (validation.pattern !== undefined && !isSafePattern(validation.pattern)) {
      issues.push({ questionId: question.id, code: 'unsafe_pattern' });
    }
  }
  if (question.criticalRegions !== undefined) {
    if (
      question.type !== 'body_map' ||
      question.criticalRegions.some((region) => !BODY_REGION_IDS.has(region))
    ) {
      issues.push({ questionId: question.id, code: 'unknown_region' });
    }
  }
  if (question.condition) {
    // conditions may only look BACKWARDS in traversal order - `earlier`
    // already contains this question and everything before it
    if (!earlier.has(question.condition.questionId)) {
      issues.push({ questionId: question.id, code: 'forward_condition' });
    }
    if (question.condition.questionId === question.id) {
      issues.push({ questionId: question.id, code: 'unknown_condition_target' });
    }
  }
  if (question.symptomMap !== undefined) {
    const map = question.symptomMap;
    const grades = ['mild', 'moderate', 'severe'];
    const mapBad =
      typeof map.code !== 'string' ||
      map.code.trim() === '' ||
      (question.type !== 'choice_single' && question.type !== 'body_map') ||
      (question.type === 'choice_single' &&
        (map.severities === undefined ||
          Object.keys(map.severities).length === 0 ||
          Object.entries(map.severities).some(
            ([optionId, grade]) =>
              !grades.includes(grade) ||
              !(question.options ?? []).some((option) => option.id === optionId),
          ))) ||
      (question.type === 'body_map' &&
        map.severity !== undefined &&
        !grades.includes(map.severity));
    if (mapBad) issues.push({ questionId: question.id, code: 'bad_symptom_map' });
  }
  if (question.valueBinding !== undefined) {
    const binding = question.valueBinding;
    const numeric = question.type === 'number' || question.type === 'scale';
    const key = binding.seriesKey;
    if (!numeric || typeof key !== 'string' || key.trim() === '' || key.length > 64) {
      issues.push({ questionId: question.id, code: 'bad_value_binding' });
    }
  }

  if (question.rules !== undefined) {
    if (!Array.isArray(question.rules) || question.rules.length > MAX_RULES_PER_QUESTION) {
      issues.push({ questionId: question.id, code: 'bad_rule' });
    } else {
      for (const rule of question.rules) {
        if (ruleIssue(question, rule)) issues.push({ questionId: question.id, code: 'bad_rule' });
      }
    }
  }
  return issues;
}

export function assertValidDefinition(definition: SurveyDefinition): void {
  const issues = validateDefinition(definition);
  if (issues.length > 0) {
    throw new Error(`invalid survey definition: ${JSON.stringify(issues)}`);
  }
}

/** Question/option ids whose text is missing from a locale bundle - a
 * variant with gaps is not offered to patients in that language (B1/B4). */
export function missingTranslations(definition: SurveyDefinition, bundle: LocaleBundle): string[] {
  const missing: string[] = [];
  for (const question of allQuestions(definition)) {
    const text = bundle.questions[question.id];
    if (!text || text.label.trim() === '') {
      missing.push(question.id);
      continue;
    }
    for (const option of question.options ?? []) {
      if (!text.options?.[option.id] || text.options[option.id]!.trim() === '') {
        missing.push(`${question.id}.${option.id}`);
      }
    }
  }
  return missing;
}

/** Deterministic JSON for content hashing - sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(',')}}`;
}

/**
 * The definition as PATIENTS may see it: template-critical body-map
 * regions and the rules that grade answers are clinician configuration
 * ("the patient never sees severities or critical areas - only the map")
 * and are stripped before a definition leaves the server on a
 * patient-facing path.
 */
export function patientView(definition: SurveyDefinition): SurveyDefinition {
  const strip = (question: Question): Question => {
    const rest: Question = { ...question };
    delete rest.criticalRegions;
    delete rest.rules;
    delete rest.symptomMap;
    delete rest.valueBinding;
    if (question.followUps) rest.followUps = question.followUps.map(strip);
    return rest;
  };
  const stripped: SurveyDefinition = {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      questions: page.questions.map(strip),
    })),
  };
  delete stripped.trendRules;
  return stripped;
}

/** The bundle as PATIENTS may see it: authored rule texts (notification
 * bodies, task titles) are clinician configuration and leave the payload
 * with the rules themselves. */
export function patientBundleView(bundle: LocaleBundle): LocaleBundle {
  const stripped: LocaleBundle = { ...bundle };
  delete stripped.rules;
  return stripped;
}
