import { describe, expect, it } from 'vitest';
import { createLifecycle } from './lifecycle.js';

describe('worker lifecycle', () => {
  it('runs stop handlers once, in reverse registration order', async () => {
    const lifecycle = createLifecycle();
    const order: string[] = [];
    lifecycle.onStop(() => {
      order.push('first');
    });
    lifecycle.onStop(() => {
      order.push('second');
    });

    await lifecycle.shutdown();
    await lifecycle.shutdown();

    expect(order).toEqual(['second', 'first']);
    expect(lifecycle.stopped).toBe(true);
  });
});
