import { describe, it, expect } from 'vitest';
import { IndicatorsService } from '../src/services/indicators.service.js';
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
});
