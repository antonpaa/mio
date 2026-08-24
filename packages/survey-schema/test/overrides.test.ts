import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  BODY_REGION_IDS,
  evaluateResponse,
  evaluateTrends,
  validateOverrides,
  type SurveyDefinition,
} from '../src/index.js';

/**
 * The effective rule set is template + program overrides; the same
 * answers behave differently in another program, and every firing's
 * trace says which layer supplied the condition.
 */

const definition: SurveyDefinition = {
  pages: [
    {
      id: 'page-1',
      questions: [
        {
          id: 'q-temp',
          type: 'number',
          rules: [
            {
              id: 'r-fever',
              when: { kind: 'at_least', value: 38 },
              outcomes: [{ kind: 'alert', severity: 'high' }],
            },
          ],
        },
        {
          id: 'q-map',
          type: 'body_map',
          criticalRegions: ['chest'],
          rules: [
            {
              id: 'r-critical',
              when: { kind: 'critical_region' },
              outcomes: [{ kind: 'alert', severity: 'high' }],
            },
          ],
        },
      ],
    },
  ],
  trendRules: [
    { id: 'r-missed', when: { kind: 'missed', times: 2 }, outcomes: [{ kind: 'task' }] },
  ],
};

describe('applyOverrides', () => {
  it('replaces thresholds and marks the rule program-sourced in the trace', () => {
    const effective = applyOverrides(definition, { rules: { 'r-fever': { value: 37.5 } } });
    const template = evaluateResponse(definition, { 'q-temp': 37.7 });
    expect(template.fired).toEqual([]); // 37.7 < 38 under the template
    const program = evaluateResponse(effective, { 'q-temp': 37.7 });
    expect(program.severity).toBe('high'); // the program tightened it
    expect(program.fired[0]!.trace.source).toBe('program');
    // the template definition is untouched
    expect(evaluateResponse(definition, { 'q-temp': 37.7 }).fired).toEqual([]);
  });

  it('a replaced critical set changes what fires - and marks region rules program-sourced', () => {
    const effective = applyOverrides(definition, {
      criticalRegions: { 'q-map': ['neck'] },
    });
    const template = evaluateResponse(definition, { 'q-map': ['neck'] });
    expect(template.fired.map((f) => f.ruleId)).toEqual([]); // neck not critical in template... other_region absent
    const program = evaluateResponse(effective, { 'q-map': ['neck'] });
    expect(program.fired.map((f) => f.ruleId)).toEqual(['r-critical']);
    expect(program.fired[0]!.trace.source).toBe('program');
  });

  it('disables rules and re-times trend windows', () => {
    const effective = applyOverrides(definition, {
      rules: { 'r-fever': { disabled: true }, 'r-missed': { times: 3 } },
    });
    expect(evaluateResponse(effective, { 'q-temp': 40 }).fired).toEqual([]);
    const twoMisses = [
      { date: '2026-08-01', status: 'missed' as const, activityId: 'a1' },
      { date: '2026-08-08', status: 'missed' as const, activityId: 'a2' },
    ];
    expect(evaluateTrends(effective, twoMisses).fired).toEqual([]); // needs 3 now
    expect(evaluateTrends(definition, twoMisses).fired).toHaveLength(1);
  });

  it('empty overrides return the definition unchanged', () => {
    expect(applyOverrides(definition, {})).toBe(definition);
  });
});

describe('validateOverrides', () => {
  it('rejects unknown rules, misfit patches and bad regions', () => {
    expect(
      validateOverrides(definition, { rules: { 'r-nope': { value: 1 } } }, BODY_REGION_IDS),
    ).toEqual([{ code: 'unknown_rule', ruleId: 'r-nope' }]);
    expect(
      validateOverrides(definition, { rules: { 'r-fever': { times: 3 } } }, BODY_REGION_IDS),
    ).toEqual([{ code: 'bad_patch', ruleId: 'r-fever' }]); // times is trend-only
    expect(
      validateOverrides(
        definition,
        { criticalRegions: { 'q-map': ['not-a-region'] } },
        BODY_REGION_IDS,
      ),
    ).toEqual([{ code: 'bad_regions', questionId: 'q-map' }]);
    expect(
      validateOverrides(
        definition,
        { rules: { 'r-fever': { value: 37.5 }, 'r-missed': { times: 3, disabled: false } } },
        BODY_REGION_IDS,
      ),
    ).toEqual([]);
  });
});
