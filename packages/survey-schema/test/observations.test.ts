import { describe, expect, it } from 'vitest';
import { deriveObservations, patientView, type SurveyDefinition } from '../src/index.js';

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
