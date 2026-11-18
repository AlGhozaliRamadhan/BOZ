import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/utils/concurrency.js';

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const items = [30, 5, 20, 1, 10];
    const result = await mapWithConcurrency(items, 3, async (ms) => {
      await delay(ms);
      return ms;
    });

    expect(result).toEqual(items);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await delay(5);
      active--;
      return null;
    });

    expect(peak).toBe(4);
  });

  it('passes the input index to the worker', async () => {
    const seen = await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, index) => `${index}:${item}`);
    expect(seen).toEqual(['0:a', '1:b', '2:c']);
  });

  it('returns immediately for an empty list', async () => {
    const worker = () => Promise.reject(new Error('should not run'));
    await expect(mapWithConcurrency([], 5, worker)).resolves.toEqual([]);
  });

  it('treats a non-positive or oversized limit as a safe bound', async () => {
    expect(await mapWithConcurrency([1, 2, 3], 0, async n => n * 2)).toEqual([2, 4, 6]);
    expect(await mapWithConcurrency([1, 2, 3], 99, async n => n * 2)).toEqual([2, 4, 6]);
  });
});
