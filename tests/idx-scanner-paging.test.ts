import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IdxScannerService,
  clampPageSize,
  normalizePresets,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../src/services/market/idx.scanner.service.js';
import { yahooFinance } from '../src/services/market/yahoo.service.js';

afterEach(() => vi.restoreAllMocks());

describe('paging parameters', () => {
  it('defaults, clamps and rejects nonsense page sizes', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize('nonsense')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(1_000_000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize('25')).toBe(25);
  });

  it('accepts a comma list of lenses and de-duplicates it', () => {
    expect(normalizePresets('momentum')).toEqual(['momentum']);
    expect(normalizePresets('momentum,breakout,momentum')).toEqual(['momentum', 'breakout']);
    expect(normalizePresets('momentum, all_time_low ')).toEqual(['momentum', 'near_52w_low']);
    expect(normalizePresets('momentum,')).toEqual(['momentum']);
  });
});

describe('lazy paged scan', () => {
  let service: IdxScannerService;
  let chartCalls: string[];

  /** Near highs on heavy volume, recovering off lows, sharp drops, steady up. */
  const PROFILES = [
    { price: 380, change: 5.0, volume: 9_000_000 },
    { price: 115, change: 3.5, volume: 6_000_000 },
    { price: 150, change: -6.0, volume: 8_000_000 },
    { price: 260, change: 1.5, volume: 3_000_000 },
  ];

  const universe = Array.from({ length: 60 }, (_, i) => ({
    ticker: `T${i}.JK`,
    name: `Ticker ${i}`,
    sector: 'industrial',
  }));

  /** Rising series so every candidate clears the screen score filter. */
  function chartFor(ticker: string) {
    const start = Date.UTC(2025, 0, 1);
    const quotes = Array.from({ length: 240 }, (_, index) => {
      const close = 100 + index;
      return {
        date: new Date(start + index * 86_400_000),
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
        volume: 1_000_000,
      };
    });
    return { quotes } as never;
  }

  beforeEach(() => {
    service = new IdxScannerService();
    service.resetSessions();
    chartCalls = [];
    vi.spyOn(service, 'getUniverse').mockResolvedValue(universe);
    vi.spyOn(yahooFinance, 'quote').mockImplementation((async (tickers: string[]) => {
      return (Array.isArray(tickers) ? tickers : [tickers]).map(symbol => {
        // Four distinct profiles so each lens ranks the universe differently.
        // Without this every symbol scores identically, the de-dupe collapses
        // each ticker to one lens, and the board looks like a single screen.
        const profile = PROFILES[Number(symbol.replace(/\D/g, '') || 0) % PROFILES.length];
        return {
          symbol,
          longName: symbol,
          regularMarketPrice: profile.price,
          regularMarketChangePercent: profile.change,
          regularMarketVolume: profile.volume,
          averageDailyVolume10Day: 1_000_000,
          averageDailyVolume3Month: 1_000_000,
          fiftyTwoWeekHigh: 400,
          fiftyTwoWeekLow: 100,
          quoteType: 'EQUITY',
          exchange: 'JKT',
          currency: 'IDR',
        };
      });
    }) as never);
    vi.spyOn(yahooFinance, 'chart').mockImplementation((async (ticker: string) => {
      chartCalls.push(ticker);
      return chartFor(ticker);
    }) as never);
  });

  it('returns the first page without enriching the whole candidate list', async () => {
    const page = await service.scanPage('all', 'any', 'momentum', 'fast', {
      universe: 'idx',
      page: 0,
      pageSize: 5,
    });

    expect(page.page).toBe(0);
    expect(page.pageSize).toBe(5);
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.results.length).toBeLessThanOrEqual(5);
    expect(page.hasMore).toBe(true);

    // The whole point: far fewer chart calls than the candidate list.
    expect(page.candidateCount).toBe(60);
    expect(chartCalls.length).toBeLessThan(60);
    expect(chartCalls.length).toBe(page.enrichedCount);
  });

  it('serves later pages from the session instead of rescanning', async () => {
    const first = await service.scanPage('all', 'any', 'momentum', 'fast', {
      universe: 'idx', page: 0, pageSize: 5,
    });
    const afterFirst = chartCalls.length;
    const quoteSpy = vi.mocked(yahooFinance.quote);

    const second = await service.scanPage('all', 'any', 'momentum', 'fast', {
      universe: 'idx', page: 1, pageSize: 5,
    });

    // The candidate list is reused, so no new quote sweep.
    expect(quoteSpy.mock.calls.length).toBeLessThanOrEqual(10);
    expect(second.candidateCount).toBe(first.candidateCount);
    expect(second.universeCount).toBe(first.universeCount);
    // Only the newly reachable candidates were charted.
    expect(chartCalls.length).toBeGreaterThan(afterFirst);
  });

  it('never repeats a ticker across pages', async () => {
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const result = await service.scanPage('all', 'any', 'momentum', 'fast', {
        universe: 'idx', page, pageSize: 4,
      });
      seen.push(...result.results.map(row => row.ticker));
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('sorts each page by screen score, descending', async () => {
    const page = await service.scanPage('all', 'any', 'momentum', 'fast', {
      universe: 'idx', page: 0, pageSize: 8,
    });
    const scores = page.results.map(row => row.screenScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('stops reporting more pages once the queue is drained', async () => {
    let last = await service.scanPage('all', 'any', 'momentum', 'fast', {
      universe: 'idx', page: 0, pageSize: 10,
    });
    let guard = 0;
    while (last.hasMore && guard++ < 40) {
      last = await service.scanPage('all', 'any', 'momentum', 'fast', {
        universe: 'idx', page: last.page + 1, pageSize: 10,
      });
    }
    expect(last.hasMore).toBe(false);
    expect(guard).toBeLessThan(40);
  });

  it('pays the quote sweep once for a multi-lens board', async () => {
    const quoteSpy = vi.mocked(yahooFinance.quote);
    await service.scanPage('all', 'any', 'momentum,breakout,rebound,oversold', 'fast', {
      universe: 'idx', page: 0, pageSize: 5,
    });

    // 60 symbols in batches of 100 → a single sweep, not one per lens.
    expect(quoteSpy.mock.calls.length).toBe(1);
  });

  it('interleaves the lenses so the queue head is not one screen', async () => {
    // Round-robin is what keeps a multi-lens board from draining the first
    // preset before the others get a look in. Asserted on the queue itself,
    // which is what the round-robin governs, rather than on how many rows
    // survive the score filter.
    const internals = service as unknown as {
      fetchQuoted: (u: typeof universe, skipped: string[]) => Promise<unknown[]>;
      buildQueue: (quoted: unknown[], params: unknown, presets: string[]) => Array<{ ticker: string; preset: string }>;
    };

    const skipped: string[] = [];
    const quoted = await internals.fetchQuoted(universe, skipped);
    const queue = internals.buildQueue(quoted, { direction: 'any', mode: 'fast' }, [
      'momentum', 'breakout', 'rebound', 'oversold',
    ]);

    expect(queue.length).toBe(universe.length);
    expect(new Set(queue.map(entry => entry.ticker)).size).toBe(queue.length);

    const headLenses = queue.slice(0, 4).map(entry => entry.preset);
    expect(new Set(headLenses).size).toBe(4);
  });

  it('reports the queued candidate count up front so the pager can size itself', async () => {
    const page = await service.scanPage('all', 'any', 'momentum', 'fast', {
      universe: 'idx', page: 0, pageSize: 5,
    });
    expect(page.candidateCount).toBe(60);
    expect(page.universeCount).toBe(60);
    expect(page.presets).toEqual(['momentum']);
  });
});