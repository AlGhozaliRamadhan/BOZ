import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/logger.js', () => {
  const passthrough = (value: string) => value;
  return {
    clr: {
      white: passthrough, cyan: passthrough, dim: passthrough,
      green: passthrough, yellow: passthrough, red: passthrough,
    },
    log: {
      data: vi.fn(), ok: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    },
  };
});

import {
  yahooFinance,
  YahooService,
  clearYahooCandleCache,
} from '../src/services/market/yahoo.service.js';

/** 90 daily bars ending today, shaped like `yahooFinance.chart()` output. */
function buildQuotes(count = 90, startClose = 100) {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const close = startClose + index;
    return {
      date: new Date(start + index * 86_400_000),
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000,
    };
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('YahooService historical candle cache', () => {
  beforeEach(() => {
    clearYahooCandleCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearYahooCandleCache();
  });

  it('serves repeated requests for the same series from one provider call', async () => {
    const chart = vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes: buildQuotes() } as any);
    const service = new YahooService();
    const period1 = new Date(Date.now() - 90 * 86_400_000);

    const first = await service.getHistoricalData('TEST', period1, '1d', false);
    const second = await service.getHistoricalData('TEST', period1, '1d', false);

    expect(chart).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // Distinct arrays: callers mutate indicators onto the candles they receive.
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
  });

  it('separates cache entries by the options that change the series', async () => {
    const chart = vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes: buildQuotes() } as any);
    const service = new YahooService();
    const period1 = new Date('2025-06-01T00:00:00Z');

    await service.getHistoricalData('OPTS', period1, '1d', false);
    await service.getHistoricalData('OPTS', period1, '1d', false, { includePrePost: false });
    await service.getHistoricalData('OPTS', period1, '1d', false, { regularHours: true });
    await service.getHistoricalData('OPTS', period1, '1d', false, { adjustPrices: true });
    // Repeating an option set must hit its own slot, not create a fifth fetch.
    await service.getHistoricalData('OPTS', period1, '1d', false, { adjustPrices: true });

    expect(chart).toHaveBeenCalledTimes(4);
  });

  it('shares one entry across symbol case and the same UTC day', async () => {
    const chart = vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes: buildQuotes() } as any);
    const service = new YahooService();

    await service.getHistoricalData('bucket', new Date('2025-06-01T00:00:00Z'), '1d', false);
    await service.getHistoricalData('BUCKET', new Date('2025-06-01T18:00:00Z'), '1d', false);
    await service.getHistoricalData('BUCKET', new Date('2025-05-31T18:00:00Z'), '1d', false);

    // Same symbol + same UTC day share; the previous day is a different window.
    expect(chart).toHaveBeenCalledTimes(2);
  });

  it('keeps caller mutations out of the shared master series', async () => {
    vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes: buildQuotes() } as any);
    const service = new YahooService();
    const period1 = new Date(Date.now() - 90 * 86_400_000);

    const first = await service.getHistoricalData('MUT', period1, '1d', false);
    const originalClose = first[0].close;
    first[0].close = 999_999;
    first[first.length - 1].SMA_20 = 1;

    const second = await service.getHistoricalData('MUT', period1, '1d', false);
    expect(second[0].close).toBe(originalClose);
    expect(second[second.length - 1].SMA_20).toBeUndefined();
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const gate = deferred<{ quotes: unknown[] }>();
    const chart = vi.spyOn(yahooFinance, 'chart').mockReturnValue(gate.promise as any);
    const service = new YahooService();
    const period1 = new Date(Date.now() - 90 * 86_400_000);

    const first = service.getHistoricalData('FLIGHT', period1, '1d', false);
    const second = service.getHistoricalData('FLIGHT', period1, '1d', false);
    await Promise.resolve();

    gate.resolve({ quotes: buildQuotes() });
    const [a, b] = await Promise.all([first, second]);

    expect(chart).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('does not cache an empty provider result', async () => {
    const chart = vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes: [] } as any);
    const service = new YahooService();
    const period1 = new Date(Date.now() - 90 * 86_400_000);

    expect(await service.getHistoricalData('EMPTY', period1, '1d', false)).toEqual([]);
    expect(await service.getHistoricalData('EMPTY', period1, '1d', false)).toEqual([]);

    expect(chart).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache on the interactive logRealtime path', async () => {
    const chart = vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes: buildQuotes() } as any);
    vi.spyOn(yahooFinance, 'quote').mockResolvedValue({ regularMarketPrice: 200 } as any);
    const service = new YahooService();
    const period1 = new Date(Date.now() - 90 * 86_400_000);

    await service.getHistoricalData('LIVE', period1, '1d', true);
    await service.getHistoricalData('LIVE', period1, '1d', true);

    expect(chart).toHaveBeenCalledTimes(2);
  });

  it('drops cached series on clearYahooCandleCache', async () => {
    const chart = vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes: buildQuotes() } as any);
    const service = new YahooService();
    const period1 = new Date(Date.now() - 90 * 86_400_000);

    await service.getHistoricalData('CLEAR', period1, '1d', false);
    clearYahooCandleCache();
    await service.getHistoricalData('CLEAR', period1, '1d', false);

    expect(chart).toHaveBeenCalledTimes(2);
  });
});
