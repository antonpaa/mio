import { describe, expect, it } from 'vitest';
import {
  deriveObservations,
  deriveValueEntries,
  validateDefinition,
  patientView,
  type SurveyDefinition,
} from '../src/index.js';

const definition: SurveyDefinition = {
  pages: [
    {
      id: 'page-1',
      questions: [
        {
          id: 'q-nausea',
          type: 'choice_single',
          options: [{ id: 'o-none' }, { id: 'o-mild' }, { id: 'o-severe' }],
          symptomMap: { code: 'nausea', severities: { 'o-mild': 'mild', 'o-severe': 'severe' } },
          followUps: [
            {
              id: 'q-map',
              type: 'body_map',
              condition: { questionId: 'q-nausea', op: 'equals', value: 'o-severe' },
              symptomMap: { code: 'skin_change', severity: 'moderate' },
            },
          ],
        },
      ],
    },
  ],
};

describe('deriveObservations', () => {
  it('grades mapped options; unmapped options record nothing', () => {
    expect(deriveObservations(definition, { 'q-nausea': 'o-severe' })).toEqual([
      { questionId: 'q-nausea', code: 'nausea', severity: 'severe' },
    ]);
    expect(deriveObservations(definition, { 'q-nausea': 'o-none' })).toEqual([]);
  });

  it('body maps record the marked regions at the mapped grade', () => {
    const derived = deriveObservations(definition, {
      'q-nausea': 'o-severe',
      'q-map': ['chest', 'neck'],
    });
    expect(derived).toEqual([
      { questionId: 'q-nausea', code: 'nausea', severity: 'severe' },
      {
        questionId: 'q-map',
        code: 'skin_change',
        severity: 'moderate',
        regions: ['chest', 'neck'],
      },
    ]);
  });

  it("a hidden question's stale answer never becomes an observation", () => {
    expect(deriveObservations(definition, { 'q-nausea': 'o-mild', 'q-map': ['chest'] })).toEqual([
      { questionId: 'q-nausea', code: 'nausea', severity: 'mild' },
    ]);
  });

  it('patientView strips the mapping', () => {
    const stripped = patientView(definition);
    expect(stripped.pages[0]!.questions[0]!.symptomMap).toBeUndefined();
  });
});

describe('deriveValueEntries', () => {
  const definition: SurveyDefinition = {
    pages: [
      {
        id: 'p',
        questions: [
          {
            id: 'psa-value',
            type: 'number',
            valueBinding: { seriesKey: 'psa', dateQuestionId: 'lab-date' },
          },
          { id: 'lab-date', type: 'date' },
          {
            id: 'gate',
            type: 'choice_single',
            options: [{ id: 'yes' }, { id: 'no' }],
            followUps: [
              {
                id: 'hidden-value',
                type: 'number',
                condition: { questionId: 'gate', equals: 'yes' },
                valueBinding: { seriesKey: 'psa' },
              },
            ],
          },
        ],
      },
    ],
  };

  it('maps the bound answer with the lab date; a hidden binding never fires', () => {
    const entries = deriveValueEntries(definition, {
      'psa-value': 6.4,
      'lab-date': '2026-08-20',
      gate: 'no',
      'hidden-value': 99, // stale answer behind a closed gate
    });
    expect(entries).toEqual([
      { questionId: 'psa-value', seriesKey: 'psa', value: 6.4, measuredAt: '2026-08-20' },
    ]);
    // without a date answer the entry still lands, undated
    expect(deriveValueEntries(definition, { 'psa-value': 5 })).toEqual([
      { questionId: 'psa-value', seriesKey: 'psa', value: 5 },
    ]);
  });

  it('validation refuses bindings on non-numeric questions and dangling date targets', () => {
    const bad: SurveyDefinition = {
      pages: [
        {
          id: 'p',
          questions: [
            {
              id: 'q1',
              type: 'choice_single',
              options: [{ id: 'a' }],
              valueBinding: { seriesKey: 'psa' },
            },
            {
              id: 'q2',
              type: 'number',
              valueBinding: { seriesKey: 'psa', dateQuestionId: 'nope' },
            },
          ],
        },
      ],
    };
    expect(
      validateDefinition(bad).filter((issue) => issue.code === 'bad_value_binding'),
    ).toHaveLength(2);
    expect(
      validateDefinition(definition).filter((issue) => issue.code === 'bad_value_binding'),
    ).toEqual([]);
  });
});
