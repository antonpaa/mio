import { describe, expect, it } from 'vitest';
import { isQuestionId, questionId } from './index.js';

describe('question ids', () => {
  it('accepts kebab-case ids', () => {
    expect(isQuestionId('nausea')).toBe(true);
    expect(isQuestionId('skin-change-2a')).toBe(true);
  });

  it('rejects ids that would not survive a URL or a translation file', () => {
    expect(isQuestionId('')).toBe(false);
    expect(isQuestionId('-leading')).toBe(false);
    expect(isQuestionId('has space')).toBe(false);
    expect(isQuestionId('Ä')).toBe(false);
  });

  it('constructor throws on invalid input', () => {
    expect(() => questionId('has space')).toThrow(/Invalid question id/);
  });
});
