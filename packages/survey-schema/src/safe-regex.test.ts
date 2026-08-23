import { describe, expect, it } from 'vitest';
import { assertSafePattern, compileSafePattern, isSafePattern } from './safe-regex.js';

describe('the linear-time-safe subset (E12)', () => {
  it('accepts the patterns clinicians actually author', () => {
    expect(isSafePattern('\\d{2}([.,]\\d)?')).toBe(true); // "38.5"
    expect(isSafePattern('[0-9]{1,3}')).toBe(true);
    expect(isSafePattern('[A-Za-zÅÄÖåäö ]{1,40}')).toBe(true);
    expect(isSafePattern('(abc)+')).toBe(true); // repeat of an unambiguous unit
    expect(isSafePattern('\\d+([.,]\\d+)?')).toBe(true);
    expect(isSafePattern('(?:mg|ml|g)')).toBe(true);
    expect(isSafePattern('\\d+(?:mg|ml)?')).toBe(true); // optional MAY hold alternation
  });

  it('rejects every catastrophic-backtracking shape', () => {
    expect(isSafePattern('(a+)+')).toBe(false); // nested unbounded
    expect(isSafePattern('(a*)*')).toBe(false);
    expect(isSafePattern('(a|a)+')).toBe(false); // ambiguous alternation under a quantifier
    expect(isSafePattern('(a|ab)*')).toBe(false);
    expect(isSafePattern('(\\d+)*')).toBe(false);
    expect(isSafePattern('(a|a){100}')).toBe(false); // bounded repetition explodes too
    expect(isSafePattern('(a\\d*){50}')).toBe(false);
  });

  it('rejects lookaround, backreferences and named groups', () => {
    expect(isSafePattern('(?=a)b')).toBe(false);
    expect(isSafePattern('(?!a)b')).toBe(false);
    expect(isSafePattern('(?<=a)b')).toBe(false);
    expect(isSafePattern('(a)\\1')).toBe(false);
    expect(isSafePattern('(?<name>a)')).toBe(false);
    expect(isSafePattern('(a)\\k<name>')).toBe(false);
  });

  it('caps the number of quantified groups', () => {
    expect(isSafePattern('(ab)?'.repeat(10))).toBe(true);
    expect(isSafePattern('(ab)?'.repeat(11))).toBe(false);
  });

  it('caps length, bounds and the number of unbounded quantifiers', () => {
    expect(isSafePattern('a'.repeat(201))).toBe(false);
    expect(isSafePattern('a{1,101}')).toBe(false);
    expect(isSafePattern('a{5,2}')).toBe(false);
    expect(isSafePattern('a{3}')).toBe(true);
    expect(isSafePattern('a*b*c*')).toBe(true); // three unbounded: at the cap
    expect(isSafePattern('a*b*c*d*')).toBe(false); // four: over it
    expect(isSafePattern('a{2,}')).toBe(true); // counts as unbounded
    expect(isSafePattern('a{2,}b{2,}c{2,}d{2,}')).toBe(false);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(isSafePattern('')).toBe(false);
    expect(isSafePattern('(a')).toBe(false);
    expect(isSafePattern('a)')).toBe(false);
    expect(isSafePattern('[a')).toBe(false);
    expect(isSafePattern('a\\')).toBe(false);
    expect(isSafePattern('*a')).toBe(false);
    expect(isSafePattern('{2}')).toBe(false);
    expect(isSafePattern('a{x}')).toBe(false);
  });

  it('compiles anchored over the whole value', () => {
    const pattern = compileSafePattern('\\d{2}([.,]\\d)?');
    expect(pattern.test('38,5')).toBe(true);
    expect(pattern.test('38')).toBe(true);
    expect(pattern.test('fever 38')).toBe(false);
    expect(() => assertSafePattern('(a+)+')).toThrow(/repetition of a group/);
  });
});
