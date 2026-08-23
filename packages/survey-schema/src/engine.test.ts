import { describe, expect, it } from 'vitest';
import {
  missingTranslations,
  normaliseDraft,
  patientView,
  progressOf,
  validateAnswer,
  validateDefinition,
  validateSubmission,
  visibleQuestions,
} from './index.js';
import type { LocaleBundle, Question, SurveyDefinition } from './types.js';

/** The canvas example: nausea -> frequency (2) -> impact (2a) -> help (2b),
 * branches nesting as deep as needed. */
const SYMPTOM: SurveyDefinition = {
  kind: 'symptom',
  pages: [
    {
      id: 'page-1',
      questions: [
        {
          id: 'nausea',
          type: 'choice_single',
          required: true,
          options: [{ id: 'none' }, { id: 'mild' }, { id: 'severe' }],
          followUps: [
            {
              id: 'nausea-frequency',
              type: 'choice_single',
              required: true,
              condition: { questionId: 'nausea', op: 'in', value: ['mild', 'severe'] },
              options: [{ id: 'once' }, { id: 'twice-or-more' }],
              followUps: [
                {
                  id: 'nausea-impact',
                  type: 'scale',
                  required: true,
                  scale: { min: 0, max: 10 },
                  condition: {
                    questionId: 'nausea-frequency',
                    op: 'equals',
                    value: 'twice-or-more',
                  },
                  followUps: [
                    {
                      id: 'nausea-help',
                      type: 'text',
                      condition: { questionId: 'nausea-impact', op: 'gte', value: 7 },
                      validation: { maxLength: 500 },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'temperature',
          type: 'text',
          validation: { pattern: '\\d{2}([.,]\\d)?', maxLength: 10 },
        },
        { id: 'weight', type: 'number', validation: { min: 20, max: 300, decimals: 1 } },
      ],
    },
  ],
};

describe('visibility and nesting (B5)', () => {
  it('hides the whole branch until the gating answers arrive', () => {
    expect(visibleQuestions(SYMPTOM, {}).map((question) => question.id)).toEqual([
      'nausea',
      'temperature',
      'weight',
    ]);
    expect(visibleQuestions(SYMPTOM, { nausea: 'severe' }).map((question) => question.id)).toEqual([
      'nausea',
      'nausea-frequency',
      'temperature',
      'weight',
    ]);
    expect(
      visibleQuestions(SYMPTOM, {
        nausea: 'severe',
        'nausea-frequency': 'twice-or-more',
        'nausea-impact': 8,
      }).map((question) => question.id),
    ).toEqual([
      'nausea',
      'nausea-frequency',
      'nausea-impact',
      'nausea-help',
      'temperature',
      'weight',
    ]);
  });

  it('a hidden question’s stale answer never satisfies a condition', () => {
    // impact=8 lingers, but the frequency answer flipped back to 'once', so
    // impact is hidden - and nausea-help must NOT appear because its
    // condition reads a hidden answer
    const visible = visibleQuestions(SYMPTOM, {
      nausea: 'mild',
      'nausea-frequency': 'once',
      'nausea-impact': 8,
    });
    expect(visible.map((question) => question.id)).toEqual([
      'nausea',
      'nausea-frequency',
      'temperature',
      'weight',
    ]);
  });

  it('progress counts VISIBLE questions only (P4 "2 of 8")', () => {
    expect(progressOf(SYMPTOM, {})).toEqual({ answered: 0, total: 3 });
    expect(progressOf(SYMPTOM, { nausea: 'none' })).toEqual({ answered: 1, total: 3 });
    expect(progressOf(SYMPTOM, { nausea: 'severe' })).toEqual({ answered: 1, total: 4 });
  });
});

describe('submission (server-authoritative)', () => {
  it('discards hidden answers so they cannot linger to fire rules', () => {
    const result = validateSubmission(SYMPTOM, {
      nausea: 'none',
      'nausea-frequency': 'twice-or-more', // stale: branch is hidden
      'nausea-impact': 9,
      weight: 72.5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answers).toEqual({ nausea: 'none', weight: 72.5 });
    }
  });

  it('required applies to visible questions only', () => {
    const missing = validateSubmission(SYMPTOM, { nausea: 'severe' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors).toEqual([{ questionId: 'nausea-frequency', code: 'required' }]);
    }
    const fine = validateSubmission(SYMPTOM, { nausea: 'none' });
    expect(fine.ok).toBe(true);
  });

  it('typed validation: options, ranges, decimals, dates, patterns', () => {
    const question = (id: string): Question => {
      const found = (function find(list: Question[]): Question | undefined {
        for (const entry of list) {
          if (entry.id === id) return entry;
          const nested = find(entry.followUps ?? []);
          if (nested) return nested;
        }
        return undefined;
      })(SYMPTOM.pages[0]!.questions);
      if (!found) throw new Error(id);
      return found;
    };
    expect(validateAnswer(question('nausea'), 'spicy')).toBe('option');
    expect(validateAnswer(question('weight'), 500)).toBe('range');
    expect(validateAnswer(question('weight'), 72.55)).toBe('decimals');
    expect(validateAnswer(question('weight'), 72.5)).toBeUndefined();
    expect(validateAnswer(question('temperature'), '38,5')).toBeUndefined();
    expect(validateAnswer(question('temperature'), 'hot')).toBe('pattern');
    expect(validateAnswer({ id: 'd', type: 'date' }, '2026-02-30')).toBe('type');
    expect(validateAnswer({ id: 'd', type: 'date' }, '2026-02-28')).toBeUndefined();
    expect(
      validateAnswer({ id: 'm', type: 'choice_multi', options: [{ id: 'a' }, { id: 'b' }] }, [
        'a',
        'a',
      ]),
    ).toBe('option');
  });

  it('drafts keep only visible valid answers, never error', () => {
    expect(
      normaliseDraft(SYMPTOM, { nausea: 'severe', weight: 9999, temperature: '38,0' }),
    ).toEqual({ nausea: 'severe', temperature: '38,0' });
  });
});

describe('definition validation (builder-by-construction, server re-check)', () => {
  it('accepts the symptom example', () => {
    expect(validateDefinition(SYMPTOM)).toEqual([]);
  });

  it('rejects forward and unknown condition references', () => {
    const bad: SurveyDefinition = {
      pages: [
        {
          id: 'p',
          questions: [
            {
              id: 'early',
              type: 'text',
              condition: { questionId: 'late', op: 'equals', value: 'x' },
            },
            { id: 'late', type: 'text' },
          ],
        },
      ],
    };
    expect(validateDefinition(bad).map((issue) => issue.code)).toContain('forward_condition');
  });

  it('rejects duplicates, empty choices, silly scales and unsafe patterns', () => {
    const bad: SurveyDefinition = {
      pages: [
        {
          id: 'p',
          questions: [
            { id: 'q-one', type: 'choice_single', options: [] },
            { id: 'q-one', type: 'scale', scale: { min: 5, max: 5 } },
            { id: 'q-two', type: 'text', validation: { pattern: '(a+)+' } },
          ],
        },
      ],
    };
    const codes = validateDefinition(bad).map((issue) => issue.code);
    expect(codes).toContain('missing_options');
    expect(codes).toContain('duplicate_id');
    expect(codes).toContain('bad_scale');
    expect(codes).toContain('unsafe_pattern');
  });
});

describe('locale bundles', () => {
  it('reports untranslated questions and options (B1/B4 "SV* — 3 untranslated")', () => {
    const bundle: LocaleBundle = {
      locale: 'sv',
      title: 'Symtomkontroll',
      questions: {
        nausea: { label: 'Illamående', options: { none: 'Inget', mild: 'Milt' } }, // severe missing
        temperature: { label: 'Temperatur' },
      },
    };
    const missing = missingTranslations(SYMPTOM, bundle);
    expect(missing).toContain('nausea.severe');
    expect(missing).toContain('weight');
    expect(missing).toContain('nausea-frequency');
    expect(missing).not.toContain('temperature');
  });
});

describe('the body map (WP-16)', () => {
  const withMap: SurveyDefinition = {
    kind: 'symptom',
    pages: [
      {
        id: 'p',
        questions: [
          {
            id: 'skin-map',
            type: 'body_map',
            required: true,
            criticalRegions: ['chest', 'neck'],
          },
        ],
      },
    ],
  };

  it('validates selections against the region catalogue', () => {
    const question = withMap.pages[0]!.questions[0]!;
    expect(validateAnswer(question, ['chest', 'forearm-left'])).toBeUndefined();
    expect(validateAnswer(question, ['chest', 'chest'])).toBe('option');
    expect(validateAnswer(question, ['elbow'])).toBe('option');
    expect(validateAnswer(question, 'chest')).toBe('type');
    expect(validateDefinition(withMap)).toEqual([]);
    expect(
      validateDefinition({
        pages: [
          { id: 'p', questions: [{ id: 'q-map', type: 'body_map', criticalRegions: ['elbow'] }] },
        ],
      }).map((issue) => issue.code),
    ).toContain('unknown_region');
  });

  it('patientView strips criticality and NOTHING else', () => {
    const stripped = patientView(withMap);
    expect(JSON.stringify(stripped)).not.toContain('criticalRegions');
    expect(stripped.pages[0]!.questions[0]!.id).toBe('skin-map');
    // the original stays intact - the server keeps the full definition
    expect(withMap.pages[0]!.questions[0]!.criticalRegions).toEqual(['chest', 'neck']);
    const submission = validateSubmission(stripped, { 'skin-map': ['chest'] });
    expect(submission.ok).toBe(true);
  });
});
