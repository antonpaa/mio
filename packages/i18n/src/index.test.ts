import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, LOCALES } from './index.js';

describe('locales', () => {
  it('ships exactly EN, FI and SV', () => {
    expect(LOCALES).toEqual(['en', 'fi', 'sv']);
  });

  it('narrows unknown input', () => {
    expect(isLocale('fi')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  it('defaults to English, the mockup language', () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });
});
