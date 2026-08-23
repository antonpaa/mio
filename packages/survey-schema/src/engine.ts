import { BODY_REGION_IDS } from './body-map.js';
import { compileSafePattern, MAX_PATTERN_INPUT_LENGTH } from './safe-regex.js';
import type {
  Answers,
  AnswerError,
  AnswerErrorCode,
  Condition,
  Question,
  SurveyDefinition,
} from './types.js';

/**
 * Visibility, progress and validation - the semantics that MUST hold
 * identically in the renderer and on the server
 * (docs/architecture/surveys-and-alerts.md):
 *
 *   - a question is visible iff its whole condition chain is satisfied,
 *     evaluated against the answers of VISIBLE questions only - a hidden
 *     question's stale answer never satisfies a condition;
 *   - progress counts visible questions only ("2 of 8");
 *   - required applies only to visible questions;
 *   - hidden answers are DISCARDED on submit, so they cannot linger to
 *     fire rules.
 */

/** Depth-first traversal order: pages, then questions, then follow-ups. */
export function allQuestions(definition: SurveyDefinition): Question[] {
  const out: Question[] = [];
  const visit = (question: Question): void => {
    out.push(question);
    for (const followUp of question.followUps ?? []) visit(followUp);
  };
  for (const page of definition.pages) for (const question of page.questions) visit(question);
  return out;
}

function conditionSatisfied(condition: Condition, visibleAnswers: Answers): boolean {
  const answer = visibleAnswers[condition.questionId];
  if (answer === undefined || answer === null || answer === '') return false;
  switch (condition.op) {
    case 'equals':
      if (Array.isArray(answer)) return answer.includes(condition.value);
      return answer === condition.value;
    case 'in': {
      const accepted = Array.isArray(condition.value) ? condition.value : [condition.value];
      if (Array.isArray(answer)) return answer.some((value) => accepted.includes(value));
      return accepted.includes(answer as string | number);
    }
    case 'gte':
      return typeof answer === 'number' && answer >= Number(condition.value);
    case 'lte':
      return typeof answer === 'number' && answer <= Number(condition.value);
  }
}

/**
 * The visible questions in order. A follow-up is visible only when its
 * PARENT is visible and its own condition holds; conditions read answers
 * of already-visible questions only, so hidden branches cannot re-enable
 * themselves and cycles are impossible by construction.
 */
export function visibleQuestions(definition: SurveyDefinition, answers: Answers): Question[] {
  const visible: Question[] = [];
  const visibleAnswers: Answers = {};
  const visit = (question: Question, parentVisible: boolean): void => {
    const own =
      parentVisible &&
      (question.condition === undefined || conditionSatisfied(question.condition, visibleAnswers));
    if (own) {
      visible.push(question);
      const answer = answers[question.id];
      if (answer !== undefined && answer !== null && answer !== '') {
        visibleAnswers[question.id] = answer;
      }
    }
    for (const followUp of question.followUps ?? []) visit(followUp, own);
  };
  for (const page of definition.pages) {
    for (const question of page.questions) visit(question, true);
  }
  return visible;
}

function isAnswered(question: Question, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (question.type === 'choice_multi' || question.type === 'body_map') {
    return Array.isArray(value) && value.length > 0;
  }
  return true;
}

/** Progress over VISIBLE questions only - P4's "2 of 8". */
export function progressOf(
  definition: SurveyDefinition,
  answers: Answers,
): { answered: number; total: number } {
  const visible = visibleQuestions(definition, answers);
  const answered = visible.filter(
    (question) =>
      isAnswered(question, answers[question.id]) &&
      validateAnswer(question, answers[question.id]) === undefined,
  ).length;
  return { answered, total: visible.length };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

/** One answer against one question. `undefined` = valid. Absence is NOT an
 * error here - required-ness is enforced by validateSubmission on visible
 * questions only. */
export function validateAnswer(question: Question, value: unknown): AnswerErrorCode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const validation = question.validation ?? {};
  switch (question.type) {
    case 'choice_single': {
      if (typeof value !== 'string') return 'type';
      return question.options?.some((option) => option.id === value) ? undefined : 'option';
    }
    case 'choice_multi': {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return 'type';
      const known = new Set((question.options ?? []).map((option) => option.id));
      if (value.some((entry) => !known.has(entry as string))) return 'option';
      if (new Set(value).size !== value.length) return 'option';
      return undefined;
    }
    case 'scale': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'type';
      const { min, max } = question.scale ?? { min: 0, max: 10 };
      return value >= min && value <= max ? undefined : 'range';
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'type';
      if (validation.min !== undefined && value < validation.min) return 'range';
      if (validation.max !== undefined && value > validation.max) return 'range';
      const decimals = validation.decimals ?? 2;
      const scaled = value * 10 ** decimals;
      if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return 'decimals';
      return undefined;
    }
    case 'date': {
      if (typeof value !== 'string' || !isRealDate(value)) return 'type';
      return undefined;
    }
    case 'body_map': {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return 'type';
      if (value.some((entry) => !BODY_REGION_IDS.has(entry as string))) return 'option';
      if (new Set(value).size !== value.length) return 'option';
      return undefined;
    }
    case 'text': {
      if (typeof value !== 'string') return 'type';
      const maxLength = Math.min(validation.maxLength ?? 4000, 4000);
      if (value.length > maxLength) return 'length';
      if (validation.pattern !== undefined) {
        // patterned fields are short-form by design; the cap keeps the
        // bounded-backtracking analysis honest (safe-regex.ts)
        if (value.length > MAX_PATTERN_INPUT_LENGTH) return 'length';
        if (!compileSafePattern(validation.pattern).test(value)) return 'pattern';
      }
      return undefined;
    }
  }
}

/**
 * Authoritative submission check: every visible required question answered,
 * every visible answer valid - and the returned answer set contains ONLY
 * visible questions' answers (hidden ones are discarded, not stored).
 */
export function validateSubmission(
  definition: SurveyDefinition,
  answers: Answers,
): { ok: true; answers: Answers } | { ok: false; errors: AnswerError[] } {
  const visible = visibleQuestions(definition, answers);
  const errors: AnswerError[] = [];
  const kept: Answers = {};
  for (const question of visible) {
    const value = answers[question.id];
    if (!isAnswered(question, value)) {
      if (question.required === true) errors.push({ questionId: question.id, code: 'required' });
      continue;
    }
    const code = validateAnswer(question, value);
    if (code !== undefined) {
      errors.push({ questionId: question.id, code });
      continue;
    }
    kept[question.id] = value;
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, answers: kept };
}

/** Draft-save shape check: visible-and-valid answers only, silently
 * dropping anything else - a draft may be incomplete, never malformed. */
export function normaliseDraft(definition: SurveyDefinition, answers: Answers): Answers {
  const visible = visibleQuestions(definition, answers);
  const kept: Answers = {};
  for (const question of visible) {
    const value = answers[question.id];
    if (isAnswered(question, value) && validateAnswer(question, value) === undefined) {
      kept[question.id] = value;
    }
  }
  return kept;
}
