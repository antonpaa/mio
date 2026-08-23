import { describe, expect, it } from 'vitest';
import {
  evaluateResponse,
  maxSeverity,
  patientView,
  validateDefinition,
  type SurveyDefinition,
} from '../src/index.js';

/**
 * The deterministic evaluator: same inputs, same rule set => same
 * outcomes, always - and a hidden question's stale answer NEVER fires.
 */

const definition: SurveyDefinition = {
  kind: 'symptom',
  pages: [
    {
      id: 'page-1',
      questions: [
        {
          id: 'q-nausea',
          type: 'choice_single',
          required: true,
          options: [{ id: 'o-none' }, { id: 'o-mild' }, { id: 'o-severe' }],
          rules: [
            {
              id: 'r-1',
              when: { kind: 'option', optionId: 'o-severe' },
              outcomes: [{ kind: 'alert', severity: 'high' }],
            },
            { id: 'r-2', when: { kind: 'option', optionId: 'o-mild' }, outcomes: [] },
          ],
          followUps: [
            {
              id: 'q-vomit',
              type: 'choice_single',
              condition: { questionId: 'q-nausea', op: 'in', value: ['o-mild', 'o-severe'] },
              options: [{ id: 'o-once' }, { id: 'o-more' }],
              rules: [
                {
                  id: 'r-3',
                  when: { kind: 'option', optionId: 'o-more' },
                  outcomes: [{ kind: 'alert', severity: 'moderate' }],
                },
              ],
            },
          ],
        },
        {
          id: 'q-temp',
          type: 'number',
          validation: { min: 34, max: 43, decimals: 1, unit: '°C' },
          rules: [
            {
              id: 'r-4',
              when: { kind: 'at_least', value: 38 },
              outcomes: [{ kind: 'alert', severity: 'high' }],
            },
            {
              id: 'r-5',
              when: { kind: 'at_most', value: 35 },
              outcomes: [{ kind: 'alert', severity: 'moderate' }],
            },
          ],
        },
        {
          id: 'q-skin',
          type: 'body_map',
          criticalRegions: ['chest', 'neck'],
          rules: [
            {
              id: 'r-6',
              when: { kind: 'critical_region' },
              outcomes: [{ kind: 'alert', severity: 'high' }],
            },
            {
              id: 'r-7',
              when: { kind: 'other_region' },
              outcomes: [{ kind: 'alert', severity: 'low' }],
            },
            {
              id: 'r-8',
              when: { kind: 'region_count', value: 3 },
              outcomes: [{ kind: 'alert', severity: 'moderate' }],
            },
          ],
        },
      ],
    },
  ],
};

describe('evaluateResponse', () => {
  it('grades to the highest severity across fired rules and traces each firing', () => {
    const evaluation = evaluateResponse(definition, {
      'q-nausea': 'o-severe',
      'q-vomit': 'o-more',
      'q-temp': 37.2,
    });
    expect(evaluation.severity).toBe('high');
    expect(evaluation.fired.map((fired) => fired.ruleId)).toEqual(['r-1', 'r-3']);
    const first = evaluation.fired[0]!;
    expect(first.trace).toMatchObject({
      ruleId: 'r-1',
      questionId: 'q-nausea',
      condition: { kind: 'option', optionId: 'o-severe' },
      source: 'template',
      observed: 'o-severe',
      matched: ['o-severe'],
      outcomes: [{ kind: 'alert', severity: 'high' }],
    });
  });

  it('never fires on a hidden question, even with a stale answer present', () => {
    // q-vomit is hidden when nausea is o-none; its stale answer must not fire r-3
    const evaluation = evaluateResponse(definition, {
      'q-nausea': 'o-none',
      'q-vomit': 'o-more',
    });
    expect(evaluation.fired).toEqual([]);
    expect(evaluation.severity).toBeNull();
  });

  it('record-only rules fire with a trace and no severity', () => {
    const evaluation = evaluateResponse(definition, { 'q-nausea': 'o-mild' });
    expect(evaluation.severity).toBeNull();
    expect(evaluation.fired).toHaveLength(1);
    expect(evaluation.fired[0]!.severity).toBeNull();
    expect(evaluation.fired[0]!.trace.outcomes).toEqual([]);
  });

  it('numeric thresholds fire at the boundary, in both directions', () => {
    expect(evaluateResponse(definition, { 'q-nausea': 'o-none', 'q-temp': 38 }).severity).toBe(
      'high',
    );
    expect(
      evaluateResponse(definition, { 'q-nausea': 'o-none', 'q-temp': 37.9 }).severity,
    ).toBeNull();
    expect(evaluateResponse(definition, { 'q-nausea': 'o-none', 'q-temp': 34.5 }).severity).toBe(
      'moderate',
    );
  });

  it('body-map rules distinguish critical, other and count - and record what matched', () => {
    const critical = evaluateResponse(definition, {
      'q-nausea': 'o-none',
      'q-skin': ['chest', 'thigh-left'],
    });
    expect(critical.severity).toBe('high');
    expect(critical.fired.map((fired) => fired.ruleId)).toEqual(['r-6', 'r-7']);
    expect(critical.fired[0]!.trace.matched).toEqual(['chest']);
    expect(critical.fired[1]!.trace.matched).toEqual(['thigh-left']);

    const spread = evaluateResponse(definition, {
      'q-nausea': 'o-none',
      'q-skin': ['thigh-left', 'thigh-right', 'abdomen'],
    });
    expect(spread.severity).toBe('moderate');
    expect(spread.fired.map((fired) => fired.ruleId)).toEqual(['r-7', 'r-8']);
  });

  it('absence fires nothing - missed-response conditions are not this path', () => {
    expect(evaluateResponse(definition, {})).toEqual({ fired: [], severity: null });
  });

  it('is deterministic: identical inputs produce identical evaluations', () => {
    const answers = { 'q-nausea': 'o-severe', 'q-temp': 39.5, 'q-skin': ['neck'] };
    expect(evaluateResponse(definition, answers)).toEqual(evaluateResponse(definition, answers));
  });
});

describe('rule validation and the patient boundary', () => {
  it('accepts the rule-carrying definition', () => {
    expect(validateDefinition(definition)).toEqual([]);
  });

  it('rejects a rule whose condition does not fit its question', () => {
    const bad: SurveyDefinition = {
      pages: [
        {
          id: 'page-1',
          questions: [
            {
              id: 'q-1',
              type: 'text',
              rules: [{ id: 'r-1', when: { kind: 'at_least', value: 3 }, outcomes: [] }],
            },
          ],
        },
      ],
    };
    expect(validateDefinition(bad)).toEqual([{ questionId: 'q-1', code: 'bad_rule' }]);
  });

  it('rejects an option rule for an option that does not exist', () => {
    const bad: SurveyDefinition = {
      pages: [
        {
          id: 'page-1',
          questions: [
            {
              id: 'q-1',
              type: 'choice_single',
              options: [{ id: 'o-1' }],
              rules: [
                {
                  id: 'r-1',
                  when: { kind: 'option', optionId: 'o-9' },
                  outcomes: [{ kind: 'alert', severity: 'low' }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(validateDefinition(bad)).toEqual([{ questionId: 'q-1', code: 'bad_rule' }]);
  });

  it('rejects duplicate rule ids across the whole survey', () => {
    const bad: SurveyDefinition = {
      pages: [
        {
          id: 'page-1',
          questions: [
            {
              id: 'q-1',
              type: 'number',
              rules: [{ id: 'r-1', when: { kind: 'at_least', value: 1 }, outcomes: [] }],
            },
            {
              id: 'q-2',
              type: 'number',
              rules: [{ id: 'r-1', when: { kind: 'at_least', value: 2 }, outcomes: [] }],
            },
          ],
        },
      ],
    };
    expect(validateDefinition(bad)).toEqual([{ questionId: 'q-2', code: 'bad_rule' }]);
  });

  it('a critical-region rule needs a critical set to exist', () => {
    const bad: SurveyDefinition = {
      pages: [
        {
          id: 'page-1',
          questions: [
            {
              id: 'q-1',
              type: 'body_map',
              rules: [{ id: 'r-1', when: { kind: 'critical_region' }, outcomes: [] }],
            },
          ],
        },
      ],
    };
    expect(validateDefinition(bad)).toEqual([{ questionId: 'q-1', code: 'bad_rule' }]);
  });

  it('patientView strips rules everywhere, follow-ups included', () => {
    const stripped = patientView(definition);
    const collect = (questions: (typeof stripped.pages)[number]['questions']): unknown[] =>
      questions.flatMap((question) => [question.rules, ...collect(question.followUps ?? [])]);
    expect(collect(stripped.pages[0]!.questions).every((rules) => rules === undefined)).toBe(true);
    // the original is untouched
    expect(definition.pages[0]!.questions[0]!.rules).toHaveLength(2);
  });
});

describe('maxSeverity', () => {
  it('orders high over moderate over low over null', () => {
    expect(maxSeverity('low', 'high')).toBe('high');
    expect(maxSeverity('moderate', 'low')).toBe('moderate');
    expect(maxSeverity(null, 'low')).toBe('low');
    expect(maxSeverity(null, null)).toBeNull();
  });
});
