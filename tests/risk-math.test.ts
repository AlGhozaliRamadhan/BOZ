import { describe, expect, it } from 'vitest';
import { risk_calc } from '../src/shared/risk-math.js';
import { executeRiskCalc } from '../src/tools/risk.tool.js';

describe('risk_calc', () => {
  it('computes stop distance, ATR multiple, sizing and per-target R:R', () => {
    const r = risk_calc({
      symbol: 'NVDA',
      side: 'long',
      entry: 233.07,
      stop: 218.94,
      targets: [245.31, 250.87],
      atr: 5,
      account_equity: 100000,
      risk_pct: 1.0,
    });
    expect(r.stop_distance).toBeCloseTo(14.13, 2);
    expect(r.stop_atr_multiple).toBeCloseTo(14.13 / 5, 4);
    expect(r.position_size).toBe(Math.floor(1000 / 14.13));
    expect(r.per_target).toHaveLength(2);
    expect(r.per_target[0].rr).toBeCloseTo(12.24 / 14.13, 2);
    expect(r.per_target[1].rr).toBeCloseTo(17.8 / 14.13, 2);
    expect(r.warnings.join(' ')).toContain('RR below 1.5');
  });

  it('warns on stop within 1 ATR and omits sizing without equity', () => {
    const r = risk_calc({
      symbol: 'NVDA',
      side: 'long',
      entry: 100,
      stop: 99.5,
      targets: [110],
      atr: 2,
    });
    expect(r.stop_distance).toBeCloseTo(0.5, 6);
    expect(r.stop_atr_multiple).toBeCloseTo(0.25, 6);
    expect(r.warnings.join(' ')).toContain('stop within 1 ATR');
    expect(r.position_size).toBeNull();
  });

  it('flags no profit-side targets', () => {
    const r = risk_calc({
      symbol: 'NVDA',
      side: 'long',
      entry: 100,
      stop: 95,
      targets: [90],
      atr: 2,
    });
    expect(r.warnings.join(' ')).toContain('no targets on the profit side');
  });

  it('NVDA regression: dashboard plan fails on contact (stop 8.7 ATR, R:R 0.16)', () => {
    const r = risk_calc({
      symbol: 'NVDA',
      side: 'long',
      entry: 237.49,
      stop: 188.96,
      targets: [245.32],
      atr: 5.59,
    });
    expect(r.stop_distance).toBeCloseTo(48.53, 2);
    expect(r.stop_atr_multiple).toBeCloseTo(48.53 / 5.59, 2);
    expect(r.per_target).toHaveLength(1);
    expect(r.per_target[0].rr).toBeCloseTo(0.16, 2);
    expect(r.warnings.join(' ')).toContain('RR below 1.5');
  });

  it('is callable via the risk_calc tool executor', async () => {
    const obs = await executeRiskCalc({
      symbol: 'NVDA',
      side: 'long',
      entry: 237.49,
      stop: 188.96,
      targets: [245.32],
      atr: 5.59,
    });
    const parsed = JSON.parse(obs);
    expect(parsed.tool).toBe('risk_calc');
    expect(parsed.stop_distance).toBeCloseTo(48.53, 2);
    expect(parsed.per_target[0].rr).toBeCloseTo(0.16, 2);
  });
});
