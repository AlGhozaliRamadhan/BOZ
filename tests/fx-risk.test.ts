import { describe, expect, it } from 'vitest';
import { buildFxRateBook, convertFxAmount, fxRiskCalc } from '../src/shared/fx-risk.js';

describe('FX currency conversion', () => {
  it('uses direct, inverse and USD-cross paths', () => {
    const book = buildFxRateBook({ EURUSD: 1.1, USDJPY: 150 });
    expect(convertFxAmount(100, 'EUR', 'USD', book)).toBeCloseTo(110, 6);
    expect(convertFxAmount(110, 'USD', 'EUR', book)).toBeCloseTo(100, 6);
    expect(convertFxAmount(15000, 'JPY', 'USD', book)).toBeCloseTo(100, 6);
    expect(convertFxAmount(100, 'EUR', 'JPY', book)).toBeCloseTo(16500, 6);
  });

  it('normalises Yahoo symbols and drops junk rates', () => {
    const book = buildFxRateBook({ 'JPY=X': 150, 'EUR/USD': 1.1, 'BAD': 2, 'GBPUSD': 0 });
    expect(book).toEqual({ USDJPY: 150, EURUSD: 1.1 });
  });

  it('returns null when no path exists', () => {
    expect(convertFxAmount(100, 'EUR', 'USD', {})).toBeNull();
  });
});

describe('fxRiskCalc', () => {
  it('prices a standard lot of EUR/USD at $10 per pip', () => {
    const result = fxRiskCalc({ pair: 'EURUSD', entry: 1.1, stop: 1.095, lots: 1, rates: { EURUSD: 1.1 } });
    expect(result.ok).toBe(true);
    expect(result.side).toBe('long');
    expect(result.stop_pips).toBe(50);
    expect(result.pip_value_per_unit).toBeCloseTo(0.0001, 8);
    expect(result.pip_value_per_lot).toBeCloseTo(10, 2);
    expect(result.position_units).toBe(100_000);
    expect(result.risk_amount).toBeCloseTo(500, 2);
    expect(result.notional_account).toBeCloseTo(110_000, 2);
    expect(result.margin_required).toBeCloseTo(3666.67, 2);
  });

  it('derives size from an account risk budget', () => {
    const result = fxRiskCalc({
      pair: 'EURUSD',
      entry: 1.1,
      stop: 1.095,
      account_equity: 10_000,
      risk_pct: 5,
      rates: { EURUSD: 1.1 },
    });
    // $500 risk / $0.005 risk per unit = 100,000 units.
    expect(result.position_units).toBe(100_000);
    expect(result.lots).toBe(1);
    expect(result.risk_amount).toBeCloseTo(500, 2);
    expect(result.risk_pct_actual).toBeCloseTo(5, 3);
  });

  it('converts pip value out of the quote currency', () => {
    const result = fxRiskCalc({
      pair: 'USDJPY',
      entry: 155,
      stop: 154,
      lots: 1,
      rates: { USDJPY: 155 },
    });
    expect(result.stop_pips).toBe(100);
    expect(result.pip_value_per_unit).toBeCloseTo(0.01 / 155, 8);
    expect(result.pip_value_per_lot).toBeCloseTo(6.45, 2);
  });

  it('handles a high-denomination Asian pair', () => {
    const result = fxRiskCalc({
      pair: 'USDIDR',
      entry: 16_250,
      stop: 16_150,
      lots: 1,
      rates: { USDIDR: 16_250 },
    });
    expect(result.stop_pips).toBe(100);
    expect(result.pip_value_per_lot).toBeCloseTo(6.15, 2);
  });

  it('flips direction for a short', () => {
    const result = fxRiskCalc({ pair: 'GBPUSD', entry: 1.25, stop: 1.255, lots: 0.5 });
    expect(result.side).toBe('short');
    expect(result.stop_pips).toBe(50);
    expect(result.position_units).toBe(50_000);
  });

  it('withholds account values when the rate book has no path', () => {
    const result = fxRiskCalc({ pair: 'USDJPY', entry: 155, stop: 154, lots: 1 });
    expect(result.ok).toBe(true);
    expect(result.pip_value_per_lot).toBeNull();
    expect(result.risk_amount).toBeNull();
    // The base currency is USD, so the notional is known even without a JPY rate.
    expect(result.notional_account).toBe(100_000);
    expect(result.warnings.join(' ')).toMatch(/conversion/i);
  });

  it('rejects an unknown pair', () => {
    const result = fxRiskCalc({ pair: 'AAPL', entry: 100, stop: 95 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown FX pair/);
  });

  it('rejects a zero-width stop', () => {
    const result = fxRiskCalc({ pair: 'EURUSD', entry: 1.1, stop: 1.1 });
    expect(result.ok).toBe(false);
  });

  it('warns when no size basis is supplied but still returns pip math', () => {
    const result = fxRiskCalc({ pair: 'EURUSD', entry: 1.1, stop: 1.09 });
    expect(result.ok).toBe(true);
    expect(result.stop_pips).toBe(100);
    expect(result.position_units).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/No position size/);
  });
});
