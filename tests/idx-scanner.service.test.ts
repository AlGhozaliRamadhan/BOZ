import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdxScannerService } from '../src/services/market/idx.scanner.service.js';
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

  it('caps fast enrichment at 60 while deep mode keeps the full valid quote set', () => {
    const service = new IdxScannerService();
    const candidates = Array.from({ length: 90 }, (_, index) => ({
      ticker: `T${index}.JK`,
      name: `Ticker ${index}`,
      sector: 'banking',
      quote: {},
      preScore: index,
    }));

    const fast = (service as any).selectChartCandidates(candidates, 'fast');
    const deep = (service as any).selectChartCandidates(candidates, 'deep');

    expect(fast).toHaveLength(60);
    expect(fast[0].ticker).toBe('T89.JK');
    expect(deep).toHaveLength(90);
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
