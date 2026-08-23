import { describe, expect, it } from 'vitest';
import { missingTranslations, validateDefinition } from '@mio/survey-schema';
import { SYNTHETIC_SURVEYS } from '../src/surveys.js';
import { generateWorld } from '../src/index.js';

describe('the synthetic survey catalog', () => {
  it('covers every survey key the world generator hands out', () => {
    const known = new Set(SYNTHETIC_SURVEYS.map((survey) => survey.key));
    const world = generateWorld('demo', 42);
    for (const treatment of world.treatments) {
      for (const key of treatment.surveyKeys) {
        expect(known.has(key), `missing definition for ${key}`).toBe(true);
      }
    }
  });

  it('every definition is structurally valid', () => {
    for (const survey of SYNTHETIC_SURVEYS) {
      expect(validateDefinition(survey.definition), survey.key).toEqual([]);
    }
  });

  it('every locale bundle is complete in en, fi and sv', () => {
    for (const survey of SYNTHETIC_SURVEYS) {
      expect(survey.locales.map((bundle) => bundle.locale).sort()).toEqual(['en', 'fi', 'sv']);
      for (const bundle of survey.locales) {
        expect(
          missingTranslations(survey.definition, bundle),
          `${survey.key} ${bundle.locale}`,
        ).toEqual([]);
      }
    }
  });

  it('no licensed instrument content is fabricated (R11)', () => {
    for (const survey of SYNTHETIC_SURVEYS) {
      expect(survey.licensedSource).toBeUndefined();
    }
  });
});
