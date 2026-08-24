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

/** Alert severity grading (docs/architecture/surveys-and-alerts.md). */
export type Severity = 'low' | 'moderate' | 'high';

/**
 * A single-response rule condition, evaluated against THIS question's
 * answer (B2/B3). Trend and missed-response conditions arrive with WP-20
 * and span occurrences; these never do.
 */
export type RuleWhen =
  /** choice: the option is the answer (single) or among it (multi) */
  | { kind: 'option'; optionId: string }
  /** number / scale: answer >= value */
  | { kind: 'at_least'; value: number }
  /** number / scale: answer <= value */
  | { kind: 'at_most'; value: number }
  /** body_map: any template-critical region marked */
  | { kind: 'critical_region' }
  /** body_map: any region OUTSIDE the critical set marked */
  | { kind: 'other_region' }
  /** body_map: at least `value` regions marked */
  | { kind: 'region_count'; value: number };

/** Custom-notification audiences (B7). "Care coordinator" waits for the
 * role to exist in the role system. */
export type NotifyRecipient = 'team' | 'lead' | 'patient';

/**
 * Rule outcomes - each optional, in any combination (B7). The authored
 * texts (notification body, task title) are human-readable content and
 * live in the locale bundles under the rule id, never here.
 */
export type RuleOutcome =
  | { kind: 'alert'; severity: Severity }
  | { kind: 'notify'; recipients: NotifyRecipient[] }
  | { kind: 'task' };

/**
 * Conditions across CONSECUTIVE occurrences of the same survey in the
 * same treatment (WP-20). `times` counts occurrences: repeat = the match
 * holds on each of the last N submitted responses; decreasing/increasing
 * = the last N submitted numeric answers are strictly monotone; missed =
 * the last N occurrences all closed unanswered. An occurrence that is
 * still open breaks every streak.
 */
export type TrendWhen =
  | { kind: 'repeat'; questionId: string; match: RuleWhen; times: number }
  | { kind: 'decreasing'; questionId: string; times: number }
  | { kind: 'increasing'; questionId: string; times: number }
  | { kind: 'missed'; times: number };

export interface TrendRule {
  id: string;
  when: TrendWhen;
  outcomes: RuleOutcome[];
  /** set at resolution time by applyOverrides - never stored */
  source?: 'template' | 'program';
}

/**
 * Declarative JSON, never authored code. An empty outcome list is the
 * designed "record only" mode: the firing is stored and visible in
 * trends, and nothing is raised.
 */
export interface QuestionRule {
  id: string;
  when: RuleWhen;
  outcomes: RuleOutcome[];
  /** which layer supplied the effective condition. Set at RESOLUTION time
   * by applyOverrides - never stored in a version. */
  source?: 'template' | 'program';
}

/**
 * Maps a question's answer into the symptom register (WP-21,
 * docs/architecture/observations.md): submitting a response writes a
 * taxonomy-coded observation. Versions with the survey like everything
 * in the definition. choice questions grade per option (unmapped
 * options record nothing); body maps record the marked regions at a
 * fixed grade.
 */
export interface SymptomMap {
  /** taxonomy code, e.g. 'nausea' */
  code: string;
  /** choice_single: option id -> observation severity */
  severities?: Record<string, 'mild' | 'moderate' | 'severe'>;
  /** body_map: the grade recorded when any region is marked */
  severity?: 'mild' | 'moderate' | 'severe';
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
  /** single-response rules on this question's answer (B2/B3). Clinician
   * configuration - stripped by patientView() like criticalRegions. */
  rules?: QuestionRule[];
  /** symptom-register mapping (WP-21). Clinician configuration -
   * stripped by patientView(). */
  symptomMap?: SymptomMap;
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
  /** survey-level rules over consecutive occurrences (B7, WP-20).
   * Clinician configuration - stripped by patientView(). */
  trendRules?: TrendRule[];
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
  /** rule id -> authored outcome texts: the custom-notification body
   * delivered AS WRITTEN, and the created task's title. Clinician
   * configuration - stripped from every patient-facing payload. */
  rules?: Record<
    string,
    {
      notifyText?: string;
      taskTitle?: string;
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
