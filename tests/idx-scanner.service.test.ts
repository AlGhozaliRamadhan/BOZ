import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdxScannerService } from '../src/services/market/idx.scanner.service.js';
import { MAX_SCAN_RESULTS } from '../src/shared/screener-contract.js';

/**
 * Fast-mode ceiling on chart-enriched candidates. Mirrors the private
 * FAST_CANDIDATE_LIMIT so the truncation assertions stay honest if the
 * pipeline budget is retuned.
 */
const FAST_CANDIDATE_LIMIT = 120;
import { yahooFinance } from '../src/services/market/yahoo.service.js';
import { deepScanWorkloadGate, WorkloadBusyError } from '../src/services/security/workload-gate.js';

afterEach(() => vi.restoreAllMocks());

describe('IDX scanner service', () => {
  it('enriches quote candidates and keeps screen match separate from Expert Signal', async () => {
    const service = new IdxScannerService();
    vi.spyOn(service, 'getUniverse').mockResolvedValue([
      { ticker: 'TEST.JK', name: 'Test Industries', sector: 'industrial' },
    ]);
    vi.spyOn(yahooFinance, 'quote').mockResolvedValue([{
      symbol: 'TEST.JK',
      longName: 'Test Industries',
      regularMarketPrice: 360,
      regularMarketChangePercent: 3.2,
      regularMarketVolume: 2_000_000,
      averageDailyVolume10Day: 1_000_000,
      averageDailyVolume3Month: 1_000_000,
      fiftyTwoWeekHigh: 400,
      fiftyTwoWeekLow: 100,
      quoteType: 'EQUITY',
      exchange: 'JKT',
      currency: 'IDR',
    }] as any);

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
    vi.spyOn(yahooFinance, 'chart').mockResolvedValue({ quotes } as any);

    const result = await service.scan('all', 'any', 'momentum', 'fast');

    expect(result.totalScanned).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].screenScore).toBe(result.results[0].score);
    expect(result.results[0].expertSignal.score).not.toBe(result.results[0].screenScore);
    expect(result.results[0].expertSignal.dataQuality).toBe(100);
    expect(result.results[0].metrics.rsi).not.toBeNull();
    expect(result.results[0].setupType).toBe('momentum');
  });

  it('retries individual quotes when a batch quote fails', async () => {
    const service = new IdxScannerService();
    const quote = vi.spyOn(yahooFinance, 'quote')
      .mockRejectedValueOnce(new Error('batch unavailable'))
      .mockResolvedValueOnce({ regularMarketPrice: 100, regularMarketVolume: 1_000 } as any);
    const skipped: string[] = [];

    const candidates = await (service as any).fetchQuoteCandidates(
      [{ ticker: 'RETRY.JK', name: 'Retry', sector: 'banking' }],
      'buy',
      'momentum',
      skipped,
    );

    expect(quote).toHaveBeenCalledTimes(2);
    expect(candidates).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it('keeps every candidate below the fast threshold and caps above it', () => {
    const service = new IdxScannerService();
    const quoted = Array.from({ length: 400 }, (_, index) => ({
      ticker: `T${index}.JK`,
      name: `Ticker ${index}`,
      sector: 'banking',
      // A quote rich enough for preScoreQuote to rank on.
      quote: {
        regularMarketPrice: 100 + index,
        regularMarketChangePercent: 1,
        regularMarketVolume: 1_000_000 + index * 1000,
        averageDailyVolume10Day: 1_000_000,
        fiftyTwoWeekHigh: 400,
        fiftyTwoWeekLow: 50,
      },
    }));

    const rank = (mode: 'fast' | 'deep', count: number) =>
      (service as any).rankCandidates(quoted.slice(0, count), 'any', 'momentum', mode) as Array<{
        ticker: string;
        preScore: number;
      }>;

    // Under FAST_FULL_SCAN_LIMIT: nothing is dropped, but it is still ranked —
    // a paged board enriches in this order, so it decides page 1.
    const small = rank('fast', 90);
    expect(small).toHaveLength(90);
    const scores = small.map(entry => entry.preScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // Over it: fast mode truncates to FAST_CANDIDATE_LIMIT, keeping the best.
    const large = rank('fast', 400);
    expect(large).toHaveLength(FAST_CANDIDATE_LIMIT);
    expect(large[0].preScore).toBeGreaterThanOrEqual(large.at(-1).preScore);

    // Deep mode is never capped.
    expect(rank('deep', 400)).toHaveLength(400);
  });

  it('exposes the scan result cap so the UI notice cannot go stale', () => {
    // ScreenerPage renders a "results capped" notice from this value.
    expect(MAX_SCAN_RESULTS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_SCAN_RESULTS)).toBe(true);
  });

  it('rejects a concurrent deep scan before fetching the universe', async () => {
    const release = deepScanWorkloadGate.tryAcquire();
    expect(release).not.toBeNull();
    const service = new IdxScannerService();
    const getUniverse = vi.spyOn(service, 'getUniverse');
    try {
      await expect(service.scan('healthcare', 'any', 'downtrend', 'deep'))
        .rejects.toBeInstanceOf(WorkloadBusyError);
      expect(getUniverse).not.toHaveBeenCalled();
    } finally {
      release?.();
    }
  });
});
