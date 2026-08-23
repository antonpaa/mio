import { describe, expect, it } from 'vitest';
import { DESIGN_SYSTEM } from './index.js';

describe('ui package', () => {
  it('names the approved direction', () => {
    expect(DESIGN_SYSTEM).toBe('warm-editorial');
  });
});
