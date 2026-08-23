import { describe, expect, it } from 'vitest';
import {
  evaluateTrends,
  patientBundleView,
  patientView,
  validateDefinition,
  type LocaleBundle,
  type SurveyDefinition,
  type TrendEntry,
} from '../src/index.js';

/**
 * Trend windows run over CONSECUTIVE occurrences; an open occurrence
 * breaks every streak, and the trace records exactly what was consumed.
 */

const definition: SurveyDefinition = {
  kind: 'symptom',
  pages: [
    {
      id: 'page-1',
      questions: [
        {
          id: 'q-fatigue',
          type: 'choice_single',
          required: true,
          options: [{ id: 'o-none' }, { id: 'o-moderate' }, { id: 'o-considerable' }],
        },
        {
          id: 'q-weight',
          type: 'number',
          validation: { min: 30, max: 250, decimals: 1, unit: 'kg' },
        },
      ],
    },
  ],
  trendRules: [
    {
      id: 'r-fatigue-run',
      when: {
        kind: 'repeat',
        questionId: 'q-fatigue',
        match: { kind: 'option', optionId: 'o-considerable' },
        times: 3,
      },
      outcomes: [
        { kind: 'alert', severity: 'moderate' },
        { kind: 'notify', recipients: ['team', 'patient'] },
      ],
    },
    {
      id: 'r-weight-drop',
      when: { kind: 'decreasing', questionId: 'q-weight', times: 3 },
      outcomes: [{ kind: 'alert', severity: 'moderate' }, { kind: 'task' }],
    },
    {
      id: 'r-missed-two',
      when: { kind: 'missed', times: 2 },
      outcomes: [{ kind: 'notify', recipients: ['lead'] }, { kind: 'task' }],
    },
  ],
};

function submitted(date: string, answers: Record<string, unknown>, n: number): TrendEntry {
  return { date, status: 'submitted', responseId: `resp-${n}`, activityId: `act-${n}`, answers };
}

describe('evaluateTrends', () => {
  it('a repeat fires exactly when the run completes, tracing the consumed window', () => {
    const two = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-fatigue': 'o-considerable' }, 1),
      submitted('2026-08-08', { 'q-fatigue': 'o-considerable' }, 2),
    ]);
    expect(two.fired).toEqual([]);

    const three = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-fatigue': 'o-considerable' }, 1),
      submitted('2026-08-08', { 'q-fatigue': 'o-considerable' }, 2),
      submitted('2026-08-15', { 'q-fatigue': 'o-considerable' }, 3),
    ]);
    expect(three.severity).toBe('moderate');
    expect(three.fired).toHaveLength(1);
    const trace = three.fired[0]!.trace;
    expect(trace.window).toHaveLength(3);
    expect(trace.window![0]).toMatchObject({
      date: '2026-08-01',
      responseId: 'resp-1',
      observed: 'o-considerable',
    });
  });

  it('a break in the run resets it - and an OPEN occurrence breaks it too', () => {
    const broken = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-fatigue': 'o-considerable' }, 1),
      submitted('2026-08-08', { 'q-fatigue': 'o-none' }, 2),
      submitted('2026-08-15', { 'q-fatigue': 'o-considerable' }, 3),
      submitted('2026-08-22', { 'q-fatigue': 'o-considerable' }, 4),
    ]);
    expect(broken.fired).toEqual([]);

    const open = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-fatigue': 'o-considerable' }, 1),
      submitted('2026-08-08', { 'q-fatigue': 'o-considerable' }, 2),
      { date: '2026-08-15', status: 'open', activityId: 'act-3' },
    ]);
    expect(open.fired).toEqual([]);
  });

  it('decreasing means strictly decreasing across the window', () => {
    const drop = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-weight': 74.5 }, 1),
      submitted('2026-08-08', { 'q-weight': 73.9 }, 2),
      submitted('2026-08-15', { 'q-weight': 72.8 }, 3),
    ]);
    expect(drop.fired.map((fired) => fired.ruleId)).toEqual(['r-weight-drop']);
    expect(drop.fired[0]!.outcomes).toEqual([
      { kind: 'alert', severity: 'moderate' },
      { kind: 'task' },
    ]);

    const flat = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-weight': 74.5 }, 1),
      submitted('2026-08-08', { 'q-weight': 74.5 }, 2),
      submitted('2026-08-15', { 'q-weight': 72.8 }, 3),
    ]);
    expect(flat.fired).toEqual([]);

    // a response that skipped the optional weight question breaks the run
    const gap = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-weight': 74.5 }, 1),
      submitted('2026-08-08', {}, 2),
      submitted('2026-08-15', { 'q-weight': 72.8 }, 3),
    ]);
    expect(gap.fired).toEqual([]);
  });

  it('missed counts consecutive unanswered occurrences and carries no alert unless authored', () => {
    const result = evaluateTrends(definition, [
      submitted('2026-08-01', { 'q-fatigue': 'o-none' }, 1),
      { date: '2026-08-08', status: 'missed', activityId: 'act-2' },
      { date: '2026-08-15', status: 'missed', activityId: 'act-3' },
    ]);
    expect(result.fired.map((fired) => fired.ruleId)).toEqual(['r-missed-two']);
    expect(result.severity).toBeNull(); // notify + task, no alert outcome
    expect(result.fired[0]!.trace.window).toEqual([
      { date: '2026-08-08', status: 'missed', activityId: 'act-2' },
      { date: '2026-08-15', status: 'missed', activityId: 'act-3' },
    ]);
  });
});

describe('trend validation and the patient boundary', () => {
  it('accepts the trend-carrying definition', () => {
    expect(validateDefinition(definition)).toEqual([]);
  });

  it('rejects windows of one, unknown questions, misfit matches and duplicate ids', () => {
    const base = definition.pages[0]!;
    const bad = (trendRules: SurveyDefinition['trendRules']): number =>
      validateDefinition({ pages: [base], trendRules }).length;
    expect(
      bad([
        {
          id: 'r-x',
          when: {
            kind: 'repeat',
            questionId: 'q-fatigue',
            match: { kind: 'option', optionId: 'o-none' },
            times: 1,
          },
          outcomes: [],
        },
      ]),
    ).toBe(1);
    expect(
      bad([
        { id: 'r-x', when: { kind: 'decreasing', questionId: 'q-nope', times: 3 }, outcomes: [] },
      ]),
    ).toBe(1);
    expect(
      bad([
        {
          id: 'r-x',
          when: {
            kind: 'repeat',
            questionId: 'q-weight',
            match: { kind: 'option', optionId: 'o-none' },
            times: 2,
          },
          outcomes: [],
        },
      ]),
    ).toBe(1);
    expect(
      bad([
        { id: 'r-x', when: { kind: 'missed', times: 2 }, outcomes: [] },
        { id: 'r-x', when: { kind: 'missed', times: 3 }, outcomes: [] },
      ]),
    ).toBe(1);
    // notify must name at least one recipient
    expect(
      bad([
        {
          id: 'r-x',
          when: { kind: 'missed', times: 2 },
          outcomes: [{ kind: 'notify', recipients: [] }],
        },
      ]),
    ).toBe(1);
  });

  it('patientView strips trend rules; patientBundleView strips authored texts', () => {
    expect(patientView(definition).trendRules).toBeUndefined();
    const bundle: LocaleBundle = {
      locale: 'en',
      title: 'T',
      questions: {},
      rules: { 'r-missed-two': { notifyText: 'We noticed…', taskTitle: 'Call the patient' } },
    };
    expect(patientBundleView(bundle).rules).toBeUndefined();
    expect(bundle.rules).toBeDefined(); // original untouched
  });
});
