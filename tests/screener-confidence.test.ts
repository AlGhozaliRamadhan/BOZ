import { describe, expect, it } from 'vitest';
import { signalConfidence } from '../src/shared/screener-confidence.js';
import type { ExpertSignal } from '../src/shared/screener-contract.js';

function makeSignal(overrides: Partial<ExpertSignal> = {}): ExpertSignal {
  return {
    bias: 'BULL',
    action: 'BUY',
    conviction: 'HIGH',
    score: 70,
    status: 'SETUP',
    reasons: ['Trend aligned'],
    warnings: [],
    dataQuality: 100,
    asOf: '2026-09-22T00:00:00.000Z',
    plan: {
      setup: 'Momentum',
      entryLabel: 'Market',
      entry: 100,
      stop: 95,
      target1: 110,
      target2: 115,
      riskReward: 2,
      invalidation: 'Through 95.',
    },
    ...overrides,
  };
}

describe('screener signal confidence', () => {
  it('rates a strong, clean read highly but never 100%', () => {
    const confidence = signalConfidence(makeSignal({ score: 95, dataQuality: 100 }));

    expect(confidence).toBeGreaterThanOrEqual(75);
    expect(confidence).toBeLessThanOrEqual(95);
  });

  it('rates a weak, warning-stacked read low but never 0%', () => {
    const confidence = signalConfidence(makeSignal({
      score: 8,
      conviction: 'LOW',
      status: 'WATCH',
      dataQuality: 70,
      warnings: ['Light participation.', 'Conflicting evidence.'],
    }));

    expect(confidence).toBeLessThan(40);
    expect(confidence).toBeGreaterThanOrEqual(5);
  });

  it('penalizes stacked warnings on otherwise identical signals', () => {
    const clean = signalConfidence(makeSignal());
    const warned = signalConfidence(makeSignal({ warnings: ['One.', 'Two.'] }));

    expect(warned).toBeLessThan(clean);
  });

  it('caps confidence when the read is NO_TRADE', () => {
    const confidence = signalConfidence(makeSignal({
      score: 90,
      dataQuality: 30,
      status: 'NO_TRADE',
    }));

    expect(confidence).toBeLessThanOrEqual(35);
  });
});
