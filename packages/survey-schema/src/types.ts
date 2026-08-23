/**
 * The question tree (docs/architecture/surveys-and-alerts.md). Structure,
 * conditions and validation live in the DEFINITION; every human-readable
 * string lives in a per-locale BUNDLE keyed by the same ids, so one version
 * is comparable across languages. Follow-ups nest as deep as needed
 * (2 -> 2a -> 2b); cycles are impossible because a condition may only
 * reference a question that appears STRICTLY EARLIER in traversal order.
 */

export type QuestionType =
  'choice_single' | 'choice_multi' | 'scale' | 'number' | 'date' | 'text' | 'body_map';

export interface ChoiceOption {
  id: string;
}

/** Visibility gate. `questionId` must be an earlier question. */
export interface Condition {
  questionId: string;
  op: 'equals' | 'in' | 'gte' | 'lte';
  value: string | number | readonly (string | number)[];
}

export interface AnswerValidation {
  /** number: inclusive bounds */
  min?: number;
  max?: number;
  /** number: allowed decimal places (0 = integer) */
  decimals?: number;
  /** number: display unit, rendered next to the input */
  unit?: string;
  /** text: authored pattern from the linear-time-safe subset (E12) */
  pattern?: string;
  /** text: length cap */
  maxLength?: number;
}

export interface Question {
  id: string;
  type: QuestionType;
  required?: boolean;
  /** choice_single / choice_multi */
  options?: ChoiceOption[];
  /** scale: integer range, labels in the bundle */
  scale?: { min: number; max: number };
  validation?: AnswerValidation;
  /** body_map: template-critical regions (B3). NEVER sent to patients -
   * the fill payload runs through patientView() first. */
  criticalRegions?: string[];
  /** visibility condition; omitted = always visible (within its parent) */
  condition?: Condition;
  /** nested follow-ups - each carries its own condition, usually on the parent */
  followUps?: Question[];
}

export interface SurveyPage {
  id: string;
  questions: Question[];
}

export interface SurveyDefinition {
  /** 'symptom' surveys render the clinic escape hatch (P4) */
  kind?: 'symptom' | 'generic';
  pages: SurveyPage[];
}

/** Per-locale text for one definition; same ids, comparable across languages. */
export interface LocaleBundle {
  locale: string;
  title: string;
  description?: string;
  questions: Record<
    string,
    {
      label: string;
      description?: string;
      /** option id -> label */
      options?: Record<string, string>;
      scaleMinLabel?: string;
      scaleMaxLabel?: string;
      /** authored error message shown when `pattern` rejects */
      patternMessage?: string;
    }
  >;
}

/** questionId -> raw answer. choice_multi: string[]; scale/number: number;
 * date: 'YYYY-MM-DD'; text: string; choice_single: option id. */
export type Answers = Record<string, unknown>;

export type AnswerErrorCode =
  'required' | 'type' | 'option' | 'range' | 'decimals' | 'length' | 'pattern';

export interface AnswerError {
  questionId: string;
  code: AnswerErrorCode;
}
