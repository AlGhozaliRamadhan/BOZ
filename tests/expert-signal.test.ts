import { describe, expect, it } from 'vitest';
import { buildExpertSignal, calculateExpertSignalDataQuality } from '../src/shared/expert-signal.js';
import type { DashboardAnalysis } from '../src/shared/dashboard-analysis.js';

function analysisFixture(): DashboardAnalysis {
  return {
    ticker: 'TEST.JK',
    assetClass: 'EQUITY',
    exchangeLabel: 'IDX',
    currency: 'IDR',
    bias: 'BULL',
    conviction: 'HIGH',
    score: 72,
    scoreLabel: 'BULLISH ALIGNED',
    signals: [
      { key: 'sma200', label: 'SMA 200', bias: 'BULL', weight: 2, detail: 'Long-term uptrend intact' },
      { key: 'macd', label: 'MACD', bias: 'BULL', weight: 1.5, detail: 'MACD above signal' },
      { key: 'rsi', label: 'RSI 14', bias: 'BULL', weight: 1, detail: 'RSI 61 — bullish momentum' },
    ],
    structure: {
      price: 1_000,
      sma20: 970,
      sma50: 930,
      sma200: 800,
      rsi: 61,
      macd: 8,
      macdSignal: 5,
      macdHist: 3,
      atr: 20,
      atrPercent: 2,
      volumeRatio: 1.6,
      obvTrend: true,
      bbPosition: 'INSIDE',
      high52w: 1_100,
      low52w: 600,
      from52wHighPct: -9.1,
      from52wLowPct: 66.7,
      range52wPos: 80,
      smaStack: 'BULL',
      weeklyLikeTrend: 'UPTREND',
    },
    plan: {
      action: 'BUY',
      status: 'SETUP',
      setup: 'Trend continuation above SMA-20 / SMA-50',
      entry: 1_000,
      entryLabel: '1,000 continuation',
      stop: 940,
      target1: 1_100,
      target2: 1_150,
      riskReward: 1.67,
      atr: 20,
      notes: 'Risk-defined continuation setup.',
      extended: false,
    },
    insights: [],
    patterns: [],
    candleBias: 'BULL',
    support: 950,
    resistance: 1_100,
  };
}

describe('Expert Signal', () => {
  it('preserves a risk-defined active setup when technical coverage is complete', () => {
    const analysis = analysisFixture();
    const signal = buildExpertSignal(analysis, '2026-09-20T00:00:00.000Z');

    expect(calculateExpertSignalDataQuality(analysis)).toBe(100);
    expect(signal.action).toBe('BUY');
    expect(signal.status).toBe('SETUP');
    expect(signal.score).toBe(72);
    expect(signal.reasons[0]).toContain('SMA 200');
    expect(signal.plan.invalidation).toContain('940');
  });

  it('downgrades an apparent setup when the evidence is incomplete', () => {
    const analysis = analysisFixture();
    analysis.structure.sma50 = null;
    analysis.structure.sma200 = null;
    analysis.structure.macd = null;
    analysis.structure.atr = null;
    analysis.structure.obvTrend = null;
    analysis.structure.high52w = null;
    analysis.structure.low52w = null;

    const signal = buildExpertSignal(analysis, '2026-09-20T00:00:00.000Z');

    expect(signal.dataQuality).toBeLessThan(45);
    expect(signal.action).toBe('WATCH');
    expect(signal.status).toBe('NO_TRADE');
    expect(signal.warnings).toContain('Insufficient technical history for an active signal.');
    expect(signal.warnings).toContain('Long-term trend is incomplete because SMA-200 is unavailable.');
  });

  it('warns instead of presenting an extended trend as a fresh entry', () => {
    const analysis = analysisFixture();
    analysis.plan.action = 'WATCH';
    analysis.plan.status = 'WATCH';
    analysis.plan.extended = true;

    const signal = buildExpertSignal(analysis, '2026-09-20T00:00:00.000Z');

    expect(signal.action).toBe('WATCH');
    expect(signal.warnings.some(warning => warning.includes('extended'))).toBe(true);
  });

  it('requires long-term trend and volume confirmation for an active setup', () => {
    const missingTrend = analysisFixture();
    missingTrend.structure.sma200 = null;
    const trendSignal = buildExpertSignal(missingTrend, '2026-09-20T00:00:00.000Z');
    expect(trendSignal.action).toBe('WATCH');
    expect(trendSignal.warnings).toContain('Long-term trend is incomplete because SMA-200 is unavailable.');

    const thinVolume = analysisFixture();
    thinVolume.structure.volumeRatio = 0.78;
    const volumeSignal = buildExpertSignal(thinVolume, '2026-09-20T00:00:00.000Z');
    expect(volumeSignal.action).toBe('WATCH');
    expect(volumeSignal.warnings).toContain('Participation is light or unavailable; wait for volume confirmation.');
  });
});
