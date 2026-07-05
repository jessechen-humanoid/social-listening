import { describe, expect, it } from 'vitest';
import { createSemaphore, mapConcurrent } from '../semaphore';

describe('createSemaphore', () => {
  it('never exceeds the limit and serves waiters in order', async () => {
    const sem = createSemaphore(2);
    let maxHeld = 0;
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 6 }, (_, i) => async () => {
        await sem.acquire();
        order.push(i);
        maxHeld = Math.max(maxHeld, sem.inFlight());
        await new Promise((r) => setTimeout(r, 5));
        sem.release();
      }).map((f) => f())
    );

    expect(maxHeld).toBe(2);
    expect(order).toHaveLength(6);
  });

  it('rejects a nonsensical limit', () => {
    expect(() => createSemaphore(0)).toThrow();
  });
});

describe('mapConcurrent', () => {
  it('bounds concurrency, preserves order, and returns all results', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await mapConcurrent([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(maxInFlight).toBe(3);
  });

  it('propagates the first error after in-flight items settle', async () => {
    await expect(
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });
});
