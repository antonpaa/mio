import { describe, expect, it } from 'vitest';
import { HEALTH_PATH } from './index.js';

describe('contracts', () => {
  it('pins the health path both sides agree on', () => {
    expect(HEALTH_PATH).toBe('/health');
  });
});
