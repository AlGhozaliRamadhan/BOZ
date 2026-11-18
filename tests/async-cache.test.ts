import { describe, expect, it, vi } from 'vitest';
import { AsyncTtlCache, cloneCandles } from '../src/utils/async-cache.js';

function manualClock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; },
  };
}

/** A promise plus the handles to settle it from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('AsyncTtlCache', () => {
  it('reuses a value until its TTL elapses, then reloads', async () => {
    const clock = manualClock();
    const cache = new AsyncTtlCache<string, number>({ ttlMs: 1_000, now: clock.now });
    const loader = vi.fn(async () => 42);

    expect(await cache.get('k', loader)).toBe(42);
    clock.advance(999);
    expect(await cache.get('k', loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);

    clock.advance(2);
    expect(await cache.get('k', loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('honours a per-call TTL override', async () => {
    const clock = manualClock();
    const cache = new AsyncTtlCache<string, number>({ ttlMs: 60_000, now: clock.now });
    const loader = vi.fn(async () => 7);

    await cache.get('long', loader, { ttlMs: 5_000 });
    clock.advance(5_001);
    await cache.get('long', loader, { ttlMs: 5_000 });
    expect(loader).toHaveBeenCalledTimes(2);

    await cache.get('default', loader);
    clock.advance(59_000);
    await cache.get('default', loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const cache = new AsyncTtlCache<string, string>({ ttlMs: 1_000 });
    const gate = deferred<string>();
    const loader = vi.fn(() => gate.promise);

    const first = cache.get('k', loader);
    const second = cache.get('k', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    gate.resolve('value');
    expect(await Promise.all([first, second])).toEqual(['value', 'value']);
  });

  it('drops a stored value on delete', async () => {
    const cache = new AsyncTtlCache<string, string>({ ttlMs: 1_000 });
    let calls = 0;
    const loader = async () => `v${++calls}`;

    expect(await cache.get('k', loader)).toBe('v1');
    cache.delete('k');
    expect(await cache.get('k', loader)).toBe('v2');
  });

  it('never caches a rejected load', async () => {
    const cache = new AsyncTtlCache<string, string>({ ttlMs: 10_000 });
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce('recovered');

    await expect(cache.get('k', loader)).rejects.toThrow('provider down');
    expect(cache.has('k')).toBe(false);

    expect(await cache.get('k', loader)).toBe('recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('returns a value without retaining it when shouldCache says no', async () => {
    const cache = new AsyncTtlCache<string, string[]>({ ttlMs: 10_000 });
    const loader = vi.fn(async () => [] as string[]);

    expect(await cache.get('k', loader, { shouldCache: value => value.length > 0 })).toEqual([]);
    expect(cache.has('k')).toBe(false);

    expect(await cache.get('k', loader, { shouldCache: value => value.length > 0 })).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest insertions once maxEntries is reached', async () => {
    const cache = new AsyncTtlCache<string, number>({ ttlMs: 10_000, maxEntries: 2 });
    await cache.get('a', async () => 1);
    await cache.get('b', async () => 2);
    await cache.get('c', async () => 3);

    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('refreshes recency on read so hot keys survive eviction', async () => {
    const cache = new AsyncTtlCache<string, number>({ ttlMs: 10_000, maxEntries: 2 });
    await cache.get('a', async () => 1);
    await cache.get('b', async () => 2);
    // Re-read 'a' so 'b' becomes the oldest entry.
    await cache.get('a', async () => 1);
    await cache.get('c', async () => 3);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('prunes expired entries without dropping live ones', async () => {
    const clock = manualClock();
    const cache = new AsyncTtlCache<string, number>({ ttlMs: 1_000, now: clock.now });
    await cache.get('short', async () => 1, { ttlMs: 100 });
    await cache.get('long', async () => 2);

    clock.advance(500);
    cache.prune();

    expect(cache.has('short')).toBe(false);
    expect(cache.has('long')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('does not retain anything when the TTL is zero or negative', async () => {
    const cache = new AsyncTtlCache<string, number>({ ttlMs: 0 });
    await cache.get('k', async () => 1);
    expect(cache.size).toBe(0);
  });
});

describe('cloneCandles', () => {
  it('returns new objects so caller mutations cannot reach the source', () => {
    const source: Array<{ close: number; SMA_20?: number }> = [
      { close: 1.5 },
      { close: 2.5 },
    ];
    const copy = cloneCandles(source);

    expect(copy).not.toBe(source);
    expect(copy[0]).not.toBe(source[0]);
    expect(copy[1]).not.toBe(source[1]);
    expect(copy).toEqual(source);

    copy[0].close = 999;
    copy[1].SMA_20 = 42;

    expect(source[0].close).toBe(1.5);
    expect(source[1].SMA_20).toBeUndefined();
  });

  it('handles an empty series', () => {
    expect(cloneCandles([])).toEqual([]);
  });
});
