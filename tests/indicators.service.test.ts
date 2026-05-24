import { describe, it, expect } from 'vitest';
import { IndicatorsService } from '../src/services/market/indicators.service.js';
import type { Candle } from '../src/types/types.js';

const buildCandles = (count: number): Candle[] => {
  const candles: Candle[] = [];
  for (let i = 1; i <= count; i++) {
    candles.push({
      date: new Date(2024, 0, i),
      open: i,
      high: i + 0.5,
      low: i - 0.5,
      close: i,
      volume: 1000 + i,
    });
  }
  return candles;
};

describe('IndicatorsService.calculateAll', () => {
  it('aligns SMA-20 to candle indices', () => {
    const candles = buildCandles(30);
    const service = new IndicatorsService();

    const result = service.calculateAll(candles);

    expect(result[18].SMA_20).toBeNull();
    expect(result[29].SMA_20).toBeCloseTo(20.5, 6);
  });

  it('calculates volume SMA and ratio after 20 candles', () => {
    const candles = buildCandles(25);
    const service = new IndicatorsService();

    const result = service.calculateAll(candles);

    const volumes = candles.slice(0, 20).map(c => c.volume);
    const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    expect(result[19].Volume_SMA).toBeCloseTo(avg, 6);
    expect(result[19].Volume_Ratio).toBeCloseTo(result[19].volume / avg, 6);
  });

  it('aligns OBV SMA to candle indices', () => {
    const candles = buildCandles(30);
    const service = new IndicatorsService();

    const result = service.calculateAll(candles);

    expect(result[18].OBV_SMA).toBeUndefined();
    expect(result[19].OBV_SMA).not.toBeUndefined();
  });
});
