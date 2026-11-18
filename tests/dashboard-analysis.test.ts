import { describe, expect, it } from 'vitest';
import { buildDashboardAnalysis } from '../src/shared/dashboard-analysis.js';
import type { Candle } from '../src/types/types.js';

/** A flat series with a known high/low per bar, oldest first. */
function buildCandles(count: number, close = 100): Candle[] {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(start + index * 86_400_000),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000_000,
  }));
}

describe('buildDashboardAnalysis aggregates', () => {
  it('computes the 52-week range over the last 252 bars only', () => {
    const candles = buildCandles(300);
    // A spike older than the 252-bar window must be ignored.
    candles[10].high = 10_000;
    candles[10].low = 1;
    // The newest bar is inside the window and therefore counts.
    candles[candles.length - 1].high = 200;

    const analysis = buildDashboardAnalysis({ ticker: 'TEST', candles });

    expect(analysis.structure.high52w).toBe(200);
    expect(analysis.structure.low52w).toBe(98);
  });

  it('prefers the quote 52-week figures when they are present', () => {
    const candles = buildCandles(120);
    const analysis = buildDashboardAnalysis({
      ticker: 'TEST',
      candles,
      quote: { fiftyTwoWeekHigh: 500, fiftyTwoWeekLow: 20 },
    });

    expect(analysis.structure.high52w).toBe(500);
    expect(analysis.structure.low52w).toBe(20);
  });

  it('falls back to the last 20 bars for support and resistance', () => {
    const candles = buildCandles(60);
    candles[0].high = 9_999;
    candles[0].low = 1;
    candles[candles.length - 1].high = 150;
    candles[candles.length - 1].low = 90;

    const analysis = buildDashboardAnalysis({ ticker: 'TEST', candles });

    expect(analysis.resistance).toBe(150);
    expect(analysis.support).toBe(90);
  });

  it('uses pattern levels when the chart analyzer supplied them', () => {
    const candles = buildCandles(60);
    const analysis = buildDashboardAnalysis({
      ticker: 'TEST',
      candles,
      patterns: {
        nearest_support: 55,
        nearest_resistance: 210,
        patterns: [],
      } as any,
    });

    expect(analysis.support).toBe(55);
    expect(analysis.resistance).toBe(210);
  });

  it('falls back to the last defined SMA-200 when the newest bar has none', () => {
    const candles = buildCandles(30);
    candles[candles.length - 4].SMA_200 = 50;

    const analysis = buildDashboardAnalysis({ ticker: 'TEST', candles });

    expect(analysis.structure.sma200).toBe(50);
  });

  it('derives the trend from the candle closes', () => {
    const rising = buildCandles(40, 100).map((candle, index) => ({
      ...candle,
      close: 100 + index * 2,
    }));
    const falling = buildCandles(40, 100).map((candle, index) => ({
      ...candle,
      close: 200 - index * 2,
    }));

    expect(buildDashboardAnalysis({ ticker: 'UP', candles: rising }).structure.weeklyLikeTrend).toBe('UPTREND');
    expect(buildDashboardAnalysis({ ticker: 'DOWN', candles: falling }).structure.weeklyLikeTrend).toBe('DOWNTREND');
  });

  it('returns the no-data shape for an empty series', () => {
    const analysis = buildDashboardAnalysis({ ticker: 'EMPTY', candles: [] });

    expect(analysis.scoreLabel).toBe('NO DATA');
    expect(analysis.support).toBeNull();
    expect(analysis.resistance).toBeNull();
  });
});
