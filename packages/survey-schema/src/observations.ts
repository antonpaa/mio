import { visibleQuestions } from './engine.js';
import type { Answers, SurveyDefinition } from './types.js';

/**
 * Derive symptom observations from a submission
 * (docs/architecture/observations.md): the survey->symptom mapping is
 * part of the definition and versions with it, so what a submission
 * writes into the register is as frozen as the questions themselves.
 * Deterministic and visibility-aware like the rule evaluator - a hidden
 * question's stale answer never becomes an observation.
 */

export interface DerivedObservation {
  questionId: string;
  code: string;
  severity: 'mild' | 'moderate' | 'severe';
  /** body-map region ids, when the mapped question is a body map */
  regions?: string[];
}

/** X8: a numeric answer bound to a value series becomes a value_entry
 * in the same transaction as the submission. */
export interface DerivedValueEntry {
  questionId: string;
  seriesKey: string;
  value: number;
  /** ISO date from the bound date question, when answered and visible */
  measuredAt?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function deriveValueEntries(
  definition: SurveyDefinition,
  answers: Answers,
): DerivedValueEntry[] {
  const visible = visibleQuestions(definition, answers);
  const out: DerivedValueEntry[] = [];
  for (const question of visible) {
    const binding = question.valueBinding;
    if (binding === undefined) continue;
    const answer = answers[question.id];
    if (typeof answer !== 'number' || !Number.isFinite(answer)) continue;
    const entry: DerivedValueEntry = {
      questionId: question.id,
      seriesKey: binding.seriesKey,
      value: answer,
    };
    if (binding.dateQuestionId !== undefined) {
      // the date must itself be a VISIBLE answer - a hidden stale date
      // never becomes provenance, same rule as everything derived
      const dateAnswer = visible.some((candidate) => candidate.id === binding.dateQuestionId)
        ? answers[binding.dateQuestionId]
        : undefined;
      if (typeof dateAnswer === 'string' && ISO_DATE.test(dateAnswer)) {
        entry.measuredAt = dateAnswer;
      }
    }
    out.push(entry);
  }
  return out;
}

export function deriveObservations(
  definition: SurveyDefinition,
  answers: Answers,
): DerivedObservation[] {
  const out: DerivedObservation[] = [];
  for (const question of visibleQuestions(definition, answers)) {
    const map = question.symptomMap;
    if (map === undefined) continue;
    const answer = answers[question.id];
    if (answer === undefined || answer === null || answer === '') continue;
    if (question.type === 'choice_single' && typeof answer === 'string') {
      const severity = map.severities?.[answer];
      if (severity !== undefined) {
        out.push({ questionId: question.id, code: map.code, severity });
      }
      continue;
    }
    if (question.type === 'body_map' && Array.isArray(answer) && answer.length > 0) {
      out.push({
        questionId: question.id,
        code: map.code,
        severity: map.severity ?? 'moderate',
        regions: answer as string[],
      });
    }
  }
  return out;
}
