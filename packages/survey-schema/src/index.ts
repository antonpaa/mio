/**
 * The shared survey engine (docs/architecture/surveys-and-alerts.md): one
 * implementation of question-tree structure, visibility, progress and
 * validation, consumed by the renderer, the builder preview and the server.
 * Built out in WP-14; this seed establishes the package and its invariant:
 * anything here must behave identically in the browser and on the server,
 * so it stays pure and dependency-free.
 */

declare const questionIdBrand: unique symbol;

/** Stable identifier of a question within a survey version. */
export type QuestionId = string & { readonly [questionIdBrand]: true };

const QUESTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export function isQuestionId(value: string): value is QuestionId {
  return QUESTION_ID_PATTERN.test(value);
}

export function questionId(value: string): QuestionId {
  if (!isQuestionId(value)) {
    throw new Error(`Invalid question id: ${JSON.stringify(value)}`);
  }
  return value;
}
