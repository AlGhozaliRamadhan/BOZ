import { describe, expect, it } from 'vitest';
import { buildIntradayPrompt, buildLongTermPrompt } from '../src/shared/prompts.js';
import type { MarketData, MacroContext } from '../src/types/types.js';
import type { ChartPatternResult } from '../src/analyzers/chart.analyzer.js';

const chartPatterns: ChartPatternResult = {
  patterns: ['No significant patterns detected'],
  pattern_confidence: ['LOW'],
  nearest_support: 95,
  nearest_resistance: 105,
  fibonacci_levels: { '0.382': 98 },
  fibonacci_position: 'MID',
  candle_patterns: {
    signals: [],
    overall_bias: 'NEUTRAL',
    bias_strength: 'WEAK',
    summary_text: 'None',
  },
};

const macroContext: MacroContext = {
  market_regime: 'RISK_ON',
  risk_sentiment: 'RISK_ON',
  sp500_correlation: 'POSITIVE',
  nasdaq_correlation: 'POSITIVE',
  tech_sector_performance: {},
};

const summary: MarketData = {
  current_price: 100,
  change_1h: 1,
  change_4h: 2,
  change_24h: -1,
  low_24h: 95,
  high_24h: 105,
  range_24h_pct: 10,
  volume: 100000,
  volume_ratio: 1.1,
  volume_classification: 'NORMAL',
  volume_trend: 'NORMAL',
  obv_signal: 'ACCUMULATION',
  obv_trend: 'BULLISH',
  obv_divergence: 'NONE',
  rsi: 55,
  macd: 0.1,
  macd_signal: 0.05,
  price_vs_sma20: 1,
  price_vs_sma50: 2,
  price_vs_sma200: 3,
  volatility_1h: 0.5,
  volatility_4h: 0.8,
  volatility_24h: 1.2,
  volatility_regime: 'NORMAL',
  volatility_warning: 'Normal volatility conditions',
  atr: 2,
  atr_percent: 2,
  bb_width: 3,
  bb_squeeze_status: 'NORMAL',
  bb_position: 'UPPER_HALF',
  is_incomplete_candle: false,
  data_age_minutes: 45,
};

const dataFreshness = {
  latest_candle_utc: '2026-05-18 14:00:00 UTC',
  age_minutes: 45,
  is_stale: true,
  is_incomplete: false,
  market_open: true,
  stale_threshold_minutes: 30,
};

const crowdSentiment = {
  fear_greed: { value: 55, label: 'Neutral', momentum: 'STABLE' },
  stocktwits_data: { bull_ratio: 55, bullish: 10, bearish: 8, total_with_sentiment: 18 },
  social_buzz: [],
  summary: { overall_signals: ['NEUTRAL'] },
};

describe('prompt formatting', () => {
  it('includes data freshness in intraday prompt', () => {
    const prompt = buildIntradayPrompt({
      summary,
      dataFreshness,
      mtfBias: {
        bias1h: 'BULL',
        bias4h: 'NEUTRAL',
        biasDaily: 'BEAR',
        alignment: 'MIXED',
        confidence: 'LOW',
      },
      marketStructure: {
        label: 'RANGING / UNCLEAR',
        strength: 'UNCERTAIN',
      },
      volumePrice: {
        signal: 'NEUTRAL',
        ratio: 1.0,
      },
      patterns: 'No clear patterns',
      chartPatterns,
      macroContext,
      newsItems: ['headline 1'],
      crowdSentiment,
    });

    expect(prompt).toContain('DATA FRESHNESS');
    expect(prompt).toContain(dataFreshness.latest_candle_utc);
    expect(prompt).not.toContain('undefined');
  });

  it('includes data freshness in long-term prompt', () => {
    const prompt = buildLongTermPrompt({
      price: 100,
      dataFreshness,
      high52w: 120,
      low52w: 80,
      pctFromHigh: -16.7,
      pctFromLow: 25,
      rangePos: 50,
      sma50: 95,
      sma200: 90,
      aboveSma50: true,
      aboveSma200: true,
      goldenCross: true,
      rsi: 55,
      atr: 2,
      maxDrawdown: -16.7,
      weeklyTrend: 'UPTREND',
      weeklyChange: 12.5,
      patterns30d: 'UPTREND',
      patterns90d: 'SIDEWAYS',
      patterns365d: 'UPTREND',
      chartPatterns,
      macroContext,
      newsItems: ['headline 1'],
      crowdSentiment,
    });

    expect(prompt).toContain('DATA FRESHNESS');
    expect(prompt).toContain(dataFreshness.latest_candle_utc);
    expect(prompt).not.toContain('undefined');
  });
});
