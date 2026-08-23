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
