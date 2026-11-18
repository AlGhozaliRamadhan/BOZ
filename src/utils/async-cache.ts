// ─── utils/async-cache.ts ─────────────────────────────────────────────────────
// Small TTL cache for async, expensive-to-recompute values.
//
// Two problems it exists to solve, both of which the market/news layer hit
// constantly:
//
//   1. TTL reuse — a dashboard poll, the chat tool and a page navigation all
//      ask for the same 420-day candle series within seconds of each other.
//   2. Single-flight — even before the first result lands, concurrent callers
//      must share one in-flight fetch instead of stampeding the provider.
//
// Entries are bounded (oldest insertion evicted first), failures are never
// cached, and the clock is injectable so TTL behaviour is testable without
// timers.

export interface AsyncTtlCacheOptions {
  /** Default entry lifetime, in milliseconds. */
  ttlMs: number;
  /** Hard ceiling on retained entries. Defaults to 500. */
  maxEntries?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface AsyncTtlCacheGetOptions<V> {
  /** Per-call lifetime override. */
  ttlMs?: number;
  /** Return false to return a value without retaining it (e.g. empty result). */
  shouldCache?: (value: V) => boolean;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

function defaultShouldCache(): boolean {
  return true;
}

export class AsyncTtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly inFlight = new Map<K, Promise<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: AsyncTtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Returns the cached value, joins an in-flight load for the same key, or
   * starts one. The loader's rejection propagates to every waiter and is not
   * cached, so the next call retries.
   */
  get(key: K, loader: () => Promise<V>, options: AsyncTtlCacheGetOptions<V> = {}): Promise<V> {
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.expiresAt > this.now()) {
        // Refresh recency so the eviction order reflects real usage.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return Promise.resolve(entry.value);
      }
      this.entries.delete(key);
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const ttlMs = options.ttlMs ?? this.ttlMs;
    const shouldCache = options.shouldCache ?? defaultShouldCache;
    const promise = (async () => {
      const value = await loader();
      if (shouldCache(value)) this.store(key, value, ttlMs);
      return value;
    })();

    this.inFlight.set(key, promise);
    // Cleanup runs on both paths; swallowing it here keeps the cleanup promise
    // from surfacing an unhandled rejection that the original await already saw.
    void promise.then(
      () => { this.inFlight.delete(key); },
      () => { this.inFlight.delete(key); },
    );
    return promise;
  }

  /** Drops one key (including any in-flight entry) without touching others. */
  delete(key: K): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  /** Drops expired entries; callers with long-lived caches can call it on write. */
  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private store(key: K, value: V, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (!this.entries.has(key)) {
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next().value as K | undefined;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}

/**
 * Deep-enough copy of a candle series so a cached master series can be handed
 * to callers that mutate what they receive (indicators write onto the last
 * candle, FX clears volume fields). OHLCV are primitives, so a shallow object
 * copy is enough.
 */
export function cloneCandles<T extends object>(candles: T[]): T[] {
  return candles.map(candle => ({ ...candle }));
}
