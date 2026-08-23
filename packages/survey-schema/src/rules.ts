import { visibleQuestions } from './engine.js';
import type {
  Answers,
  Question,
  QuestionRule,
  RuleOutcome,
  RuleWhen,
  Severity,
  SurveyDefinition,
} from './types.js';

/**
 * The deterministic rule evaluator (docs/architecture/surveys-and-alerts.md):
 * one declarative model, one evaluator, one trace format for everything the
 * system does in reaction to clinical input. Same inputs, same effective
 * rule set => same outcomes, always - the builder preview and the server
 * run THIS function.
 *
 * Evaluation walks VISIBLE questions only: a hidden question's stale
 * answer must never fire a rule. validateSubmission already discards
 * hidden answers before storage; this is the second, independent wall.
 */

export const SEVERITIES: readonly Severity[] = ['low', 'moderate', 'high'];

const SEVERITY_RANK: Record<Severity, number> = { low: 1, moderate: 2, high: 3 };

export function maxSeverity(a: Severity | null, b: Severity | null): Severity | null {
  if (a === null) return b;
  if (b === null) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Why a rule fired - stored verbatim on the trigger row from day one.
 * Records the answer read, the condition and threshold, which layer
 * supplied it (program overrides arrive with WP-22), and every outcome
 * produced. "Why did this fire?" has one answer forever.
 */
export interface RuleTrace {
  ruleId: string;
  questionId: string;
  condition: RuleWhen;
  /** which rule layer supplied the condition; WP-22 adds 'program' */
  source: 'template';
  /** the answer the condition read, exactly as submitted */
  observed: unknown;
  /** what satisfied the condition: the matched option id, or the
   * body-map region ids that met the criterion */
  matched?: string[];
  outcomes: RuleOutcome[];
}

/** A single fired rule - what an alert cites as a trigger. */
export interface FiredRule {
  ruleId: string;
  questionId: string;
  /** highest alert severity among this rule's outcomes; null = record only */
  severity: Severity | null;
  trace: RuleTrace;
}

export interface Evaluation {
  /** every rule whose condition held, in definition order */
  fired: FiredRule[];
  /** highest severity across all fired alert outcomes; null = no alert */
  severity: Severity | null;
}

function matchWhen(
  question: Question,
  when: RuleWhen,
  answer: unknown,
): { hit: boolean; matched?: string[] } {
  switch (when.kind) {
    case 'option': {
      if (question.type === 'choice_single') {
        return answer === when.optionId ? { hit: true, matched: [when.optionId] } : { hit: false };
      }
      if (question.type === 'choice_multi' && Array.isArray(answer)) {
        return answer.includes(when.optionId)
          ? { hit: true, matched: [when.optionId] }
          : { hit: false };
      }
      return { hit: false };
    }
    case 'at_least':
      return { hit: typeof answer === 'number' && answer >= when.value };
    case 'at_most':
      return { hit: typeof answer === 'number' && answer <= when.value };
    case 'critical_region': {
      if (question.type !== 'body_map' || !Array.isArray(answer)) return { hit: false };
      const critical = new Set(question.criticalRegions ?? []);
      const matched = answer.filter((region): region is string => critical.has(region as string));
      return matched.length > 0 ? { hit: true, matched } : { hit: false };
    }
    case 'other_region': {
      if (question.type !== 'body_map' || !Array.isArray(answer)) return { hit: false };
      const critical = new Set(question.criticalRegions ?? []);
      const matched = answer.filter(
        (region): region is string => typeof region === 'string' && !critical.has(region),
      );
      return matched.length > 0 ? { hit: true, matched } : { hit: false };
    }
    case 'region_count': {
      if (question.type !== 'body_map' || !Array.isArray(answer)) return { hit: false };
      return answer.length >= when.value
        ? { hit: true, matched: answer as string[] }
        : { hit: false };
    }
  }
}

function ruleSeverity(rule: QuestionRule): Severity | null {
  let severity: Severity | null = null;
  for (const outcome of rule.outcomes) {
    if (outcome.kind === 'alert') severity = maxSeverity(severity, outcome.severity);
  }
  return severity;
}

/**
 * Evaluate every rule of every VISIBLE question against a submission's
 * answers. Absence never fires a single-response rule - missed-response
 * conditions are WP-20's occurrence-driven kind, not this path.
 */
export function evaluateResponse(definition: SurveyDefinition, answers: Answers): Evaluation {
  const fired: FiredRule[] = [];
  let severity: Severity | null = null;
  for (const question of visibleQuestions(definition, answers)) {
    const rules = question.rules ?? [];
    if (rules.length === 0) continue;
    const answer = answers[question.id];
    if (answer === undefined || answer === null || answer === '') continue;
    for (const rule of rules) {
      const { hit, matched } = matchWhen(question, rule.when, answer);
      if (!hit) continue;
      const own = ruleSeverity(rule);
      severity = maxSeverity(severity, own);
      fired.push({
        ruleId: rule.id,
        questionId: question.id,
        severity: own,
        trace: {
          ruleId: rule.id,
          questionId: question.id,
          condition: rule.when,
          source: 'template',
          observed: answer,
          ...(matched !== undefined ? { matched } : {}),
          outcomes: rule.outcomes,
        },
      });
    }
  }
  return { fired, severity };
}
