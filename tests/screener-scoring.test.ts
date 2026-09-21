import { describe, expect, it } from 'vitest';
import { scoreScreenerPreset } from '../src/shared/screener-scoring.js';
import type { ScreenerMetrics } from '../src/shared/screener-contract.js';

const baseMetrics: ScreenerMetrics = {
  price: 1_000,
  chg1d: 1,
  chg5d: 4,
  chg20d: 10,
  volumeRatio: 1.5,
  rsi: 60,
  macdHistogram: 2,
  from52wHigh: -12,
  from52wLow: 35,
  atrPercent: 2,
};

describe('screener preset scoring', () => {
  it('ranks a confirmed breakout above a distant, low-volume ticker', () => {
    const confirmed = scoreScreenerPreset('breakout', {
      ...baseMetrics,
      from52wHigh: -2,
      volumeRatio: 2.2,
      chg1d: 3,
    });
    const weak = scoreScreenerPreset('breakout', {
      ...baseMetrics,
      from52wHigh: -40,
      volumeRatio: 0.7,
      chg1d: -1,
      macdHistogram: -2,
    });

    expect(confirmed).toBeGreaterThanOrEqual(75);
    expect(confirmed).toBeGreaterThan(weak);
  });

  it('uses a truthful 52-week-low screen instead of claiming an all-time low', () => {
    const nearLow = scoreScreenerPreset('near_52w_low', {
      ...baseMetrics,
      from52wLow: 3,
      from52wHigh: -55,
      rsi: 32,
      chg20d: -12,
    });
    const midRange = scoreScreenerPreset('near_52w_low', baseMetrics);

    expect(nearLow).toBeGreaterThanOrEqual(80);
    expect(nearLow).toBeGreaterThan(midRange);
  });

  it('does not infer direction from the screen match score', () => {
    const oversoldScore = scoreScreenerPreset('oversold', {
      ...baseMetrics,
      rsi: 24,
      chg20d: -25,
      from52wLow: 8,
    });

    expect(oversoldScore).toBeGreaterThanOrEqual(75);
    // Direction is intentionally absent from this result; Expert Signal owns it.
    expect(typeof oversoldScore).toBe('number');
  });

  it('recognizes bearish momentum without changing the Expert Signal direction', () => {
    const score = scoreScreenerPreset('momentum', {
      ...baseMetrics,
      chg1d: -2,
      chg5d: -7,
      chg20d: -16,
      rsi: 39,
      macdHistogram: -2,
      volumeRatio: 1.8,
    });

    expect(score).toBeGreaterThanOrEqual(70);
  });
});
