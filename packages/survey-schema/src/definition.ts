import { allQuestions } from './engine.js';
import { isSafePattern } from './safe-regex.js';
import { isQuestionId } from './ids.js';
import type { LocaleBundle, Question, SurveyDefinition } from './types.js';

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
    | 'empty';
}

export function validateDefinition(definition: SurveyDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const questions = allQuestions(definition);
  if (questions.length === 0) {
    issues.push({ code: 'empty' });
    return issues;
  }
  const seen = new Set<string>();
  for (const question of questions) {
    if (!isQuestionId(question.id)) issues.push({ questionId: question.id, code: 'bad_id' });
    if (seen.has(question.id)) issues.push({ questionId: question.id, code: 'duplicate_id' });
    seen.add(question.id);
    issues.push(...questionIssues(question, seen));
  }
  return issues;
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
