// ─── utils/concurrency.ts ─────────────────────────────────────────────────────
// Bounded parallel mapping for independent network work.
//
// Feeds and provider calls are usually independent but were awaited one after
// another, so a slow feed serialised everything behind it. A bounded map keeps
// provider load sane while collecting results in input order, which is what
// lets callers keep deterministic output after parallelising.

/**
 * Runs `worker` over `items` with at most `limit` concurrent calls.
 * Results come back in input order, never in completion order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
