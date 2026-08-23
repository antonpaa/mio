/**
 * The shared survey engine (docs/architecture/surveys-and-alerts.md): one
 * implementation of question-tree structure, visibility, progress and
 * validation, consumed by the renderer, the builder preview and the server.
 * Anything here must behave identically in the browser and on the server,
 * so it stays pure and dependency-free.
 */

export { isQuestionId, questionId, type QuestionId } from './ids.js';
export type {
  Answers,
  AnswerError,
  AnswerErrorCode,
  AnswerValidation,
  ChoiceOption,
  Condition,
  LocaleBundle,
  Question,
  QuestionRule,
  QuestionType,
  RuleOutcome,
  RuleWhen,
  Severity,
  SurveyDefinition,
  SurveyPage,
} from './types.js';
export {
  allQuestions,
  normaliseDraft,
  progressOf,
  validateAnswer,
  validateSubmission,
  visibleQuestions,
} from './engine.js';
export {
  assertValidDefinition,
  canonicalJson,
  MAX_RULES_PER_QUESTION,
  missingTranslations,
  patientView,
  validateDefinition,
  type DefinitionIssue,
} from './definition.js';
export {
  evaluateResponse,
  maxSeverity,
  SEVERITIES,
  type Evaluation,
  type FiredRule,
  type RuleTrace,
} from './rules.js';
export {
  BODY_REGION_IDS,
  BODY_REGIONS,
  type BodyRegion,
  type BodySide,
  type BodyView,
} from './body-map.js';
export {
  assertSafePattern,
  compileSafePattern,
  isSafePattern,
  MAX_BOUNDED_REPEAT,
  MAX_PATTERN_INPUT_LENGTH,
  MAX_PATTERN_LENGTH,
  MAX_QUANTIFIED_GROUPS,
  MAX_UNBOUNDED_QUANTIFIERS,
} from './safe-regex.js';
