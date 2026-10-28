import { describe, expect, it } from 'vitest';
import { sanitizeFxCandles } from '../src/services/market/fx.service.js';
import type { Candle } from '../src/types/types.js';

function candle(date: string, close: number, patch: Partial<Candle> = {}): Candle {
  return { date: new Date(date), open: close, high: close, low: close, close, volume: 0, ...patch };
}

describe('FX candle sanitation', () => {
  it('drops the partial Sunday bar from daily series', () => {
    // 2026-03-15 is a Sunday; 2026-03-16 is the first real Monday session.
    const candles = [
      candle('2026-03-13T00:00:00Z', 1.1412),
      candle('2026-03-15T00:00:00Z', 1.1414),
      candle('2026-03-16T00:00:00Z', 1.1421),
    ];
    const kept = sanitizeFxCandles(candles, '1d');
    expect(kept.map(c => c.date.toISOString().slice(0, 10))).toEqual(['2026-03-13', '2026-03-16']);
  });

  it('keeps intraday bars: Sunday is not a meaningful boundary there', () => {
    const candles = [
      candle('2026-03-15T22:00:00Z', 1.1414),
      candle('2026-03-16T01:00:00Z', 1.1421),
    ];
    expect(sanitizeFxCandles(candles, '1h')).toHaveLength(2);
  });

  it('drops holiday placeholders that come back as zeros or nulls', () => {
    const candles = [
      candle('2026-03-16T00:00:00Z', 1.1421),
      candle('2026-03-17T00:00:00Z', 0),
      candle('2026-03-18T00:00:00Z', 1.1430, { open: Number.NaN }),
      candle('2026-03-19T00:00:00Z', 1.1442, { high: 0 }),
    ];
    const kept = sanitizeFxCandles(candles, '1d');
    expect(kept).toHaveLength(1);
    expect(kept[0].close).toBe(1.1421);
  });

  it('returns an empty series instead of throwing when nothing is usable', () => {
    expect(sanitizeFxCandles([], '1d')).toEqual([]);
    expect(sanitizeFxCandles([candle('2026-03-15T00:00:00Z', 0)], '1d')).toEqual([]);
  });

  it('drops Sunday bars from weekly series too', () => {
    const candles = [
      candle('2026-03-15T00:00:00Z', 1.1414),
      candle('2026-03-16T00:00:00Z', 1.1520),
    ];
    expect(sanitizeFxCandles(candles, '1wk')).toHaveLength(1);
  });
});
