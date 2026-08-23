import { allQuestions, visibleQuestions } from './engine.js';
import type {
  Answers,
  Question,
  RuleOutcome,
  RuleWhen,
  Severity,
  SurveyDefinition,
  TrendWhen,
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
  questionId: string | null;
  condition: RuleWhen | TrendWhen;
  /** which rule layer supplied the condition (template default, or a
   * program override - WP-22) */
  source: 'template' | 'program';
  /** the answer the condition read, exactly as submitted; null for
   * absence-driven (missed) conditions */
  observed: unknown;
  /** what satisfied the condition: the matched option id, or the
   * body-map region ids that met the criterion */
  matched?: string[];
  /** trend conditions record exactly which prior occurrences they
   * consumed - "the prior responses a trend condition read" */
  window?: {
    date: string;
    status: 'submitted' | 'missed';
    responseId?: string;
    activityId?: string;
    observed?: unknown;
  }[];
  outcomes: RuleOutcome[];
}

/** A single fired rule - what an alert cites as a trigger. */
export interface FiredRule {
  ruleId: string;
  questionId: string | null;
  /** highest alert severity among this rule's outcomes; null = no alert
   * outcome (record only, or notify/task without an alert) */
  severity: Severity | null;
  outcomes: RuleOutcome[];
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

function ruleSeverity(rule: { outcomes: RuleOutcome[] }): Severity | null {
  let severity: Severity | null = null;
  for (const outcome of rule.outcomes) {
    if (outcome.kind === 'alert') severity = maxSeverity(severity, outcome.severity);
  }
  return severity;
}

/**
 * One occurrence of the survey in the treatment, oldest -> newest. An
 * occurrence still inside its answer window is 'open' and breaks every
 * streak - a trend over it would be a guess, and this evaluator never
 * guesses.
 */
export interface TrendEntry {
  /** occurrence date (date-level, the schedule's own granularity) */
  date: string;
  status: 'submitted' | 'missed' | 'open';
  responseId?: string;
  activityId?: string;
  /** the submitted answers, exactly as stored (hidden ones were
   * discarded at submission) */
  answers?: Answers;
}

function windowOf(entries: TrendEntry[], questionId: string | null) {
  return entries.map((entry) => ({
    date: entry.date,
    status: entry.status === 'submitted' ? ('submitted' as const) : ('missed' as const),
    ...(entry.responseId !== undefined ? { responseId: entry.responseId } : {}),
    ...(entry.activityId !== undefined ? { activityId: entry.activityId } : {}),
    ...(questionId !== null && entry.answers !== undefined
      ? { observed: entry.answers[questionId] }
      : {}),
  }));
}

/**
 * Evaluate the survey-level trend rules against the occurrence history
 * (docs/architecture/surveys-and-alerts.md): windows are consecutive
 * occurrences of the SAME survey in the SAME treatment, and the trace
 * records exactly which prior occurrences each condition consumed.
 * Deterministic like everything here: same history, same rule set =>
 * same firings.
 */
export function evaluateTrends(definition: SurveyDefinition, entries: TrendEntry[]): Evaluation {
  const fired: FiredRule[] = [];
  let severity: Severity | null = null;
  const rules = definition.trendRules ?? [];
  if (rules.length === 0 || entries.length === 0) return { fired, severity };
  const questions = new Map(allQuestions(definition).map((question) => [question.id, question]));

  for (const rule of rules) {
    const when = rule.when;
    const tail = entries.slice(-when.times);
    if (tail.length < when.times) continue;
    let hit: boolean;
    let questionId: string | null = null;

    if (when.kind === 'missed') {
      hit = tail.every((entry) => entry.status === 'missed');
    } else {
      questionId = when.questionId;
      const question = questions.get(when.questionId);
      if (!question) continue;
      if (!tail.every((entry) => entry.status === 'submitted')) continue;
      if (when.kind === 'repeat') {
        hit = tail.every(
          (entry) => matchWhen(question, when.match, entry.answers?.[when.questionId]).hit,
        );
      } else {
        const values = tail.map((entry) => entry.answers?.[when.questionId]);
        if (values.some((value) => typeof value !== 'number')) continue;
        const numbers = values as number[];
        hit = numbers.every((value, index) =>
          index === 0
            ? true
            : when.kind === 'decreasing'
              ? value < numbers[index - 1]!
              : value > numbers[index - 1]!,
        );
      }
    }
    if (!hit) continue;
    const own = ruleSeverity(rule);
    severity = maxSeverity(severity, own);
    const latest = tail[tail.length - 1]!;
    fired.push({
      ruleId: rule.id,
      questionId,
      severity: own,
      outcomes: rule.outcomes,
      trace: {
        ruleId: rule.id,
        questionId,
        condition: when,
        source: rule.source ?? 'template',
        observed:
          questionId !== null && latest.answers !== undefined ? latest.answers[questionId] : null,
        window: windowOf(tail, questionId),
        outcomes: rule.outcomes,
      },
    });
  }
  return { fired, severity };
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
        outcomes: rule.outcomes,
        trace: {
          ruleId: rule.id,
          questionId: question.id,
          condition: rule.when,
          source: rule.source ?? 'template',
          observed: answer,
          ...(matched !== undefined ? { matched } : {}),
          outcomes: rule.outcomes,
        },
      });
    }
  }
  return { fired, severity };
}
