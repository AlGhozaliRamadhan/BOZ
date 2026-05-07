import type { MarketData, MacroContext } from '../types/types.js';
import type { ChartPatternResult } from '../analyzers/chart.analyzer.js';
import { rsiLabel } from '../utils/display.js';

export interface CrowdSentimentData {
  fear_greed?: {
    value?: number;
    label?: string;
    momentum?: string;
  } | null;
  stocktwits_nvda?: {
    bull_ratio?: number;
    bullish?: number;
    bearish?: number;
    total_with_sentiment?: number;
  } | null;
  summary?: {
    overall_signals?: string[];
  } | null;
}

export interface IntradayPromptData {
  summary: MarketData;
  mtfBias: {
    bias1h: string;
    bias4h: string;
    biasDaily: string;
    alignment: string;
    confidence: string;
  };
  marketStructure: {
    label: string;
    strength: string;
  };
  volumePrice: {
    signal: string;
    ratio: number;
  };
  patterns: string;
  chartPatterns: ChartPatternResult;
  macroContext: MacroContext;
  newsItems: string[];
  crowdSentiment: CrowdSentimentData;
}

export interface LongTermPromptData {
  price: number;
  high52w: number;
  low52w: number;
  pctFromHigh: number;
  pctFromLow: number;
  rangePos: number;
  sma50: number | null;
  sma200: number | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  goldenCross: boolean;
  rsi: number | null;
  atr: number | null;
  maxDrawdown: number;
  weeklyTrend: string;
  weeklyChange: number;
  patterns30d: string;
  patterns90d: string;
  patterns365d: string;
  chartPatterns: ChartPatternResult;
  macroContext: MacroContext;
  newsItems: string[];
}

function buildContrarianNote(crowdSentiment: CrowdSentimentData): string {
  const br = crowdSentiment.stocktwits_nvda?.bull_ratio ?? 50;
  const fg = crowdSentiment.fear_greed?.value ?? 50;
  if (br > 70 && fg > 60) return '⚠ HIGH CONTRARIAN RISK — retail euphoria on both metrics; historically bearish for near-term';
  if (br > 70)            return '⚠ StockTwits crowd is euphoric (>70% bullish) — apply contrarian caution';
  if (br < 30 && fg < 40) return '✓ HIGH CONTRARIAN OPPORTUNITY — retail fear on both metrics; historically bullish for near-term';
  if (br < 30)            return '✓ StockTwits crowd is fearful (<30% bullish) — apply contrarian bullish bias';
  return 'Neutral — no extreme crowd signal';
}

export function buildIntradayPrompt(data: IntradayPromptData): string {
  const { summary, mtfBias, marketStructure, volumePrice, patterns, chartPatterns, macroContext, newsItems, crowdSentiment } = data;

  return `You are an expert NVDA stock trading analyst focused on INTRADAY trading.
Your goal is to predict price movement over the next 2-6 hours.

CURRENT MARKET DATA:
- Current Price: $${summary.current_price.toFixed(2)}
- 1H Change: ${summary.change_1h.toFixed(2)}%
- 4H Change: ${summary.change_4h.toFixed(2)}%
- 24H Change: ${summary.change_24h.toFixed(2)}%
- 24H High: $${summary.high_24h.toFixed(2)}  Low: $${summary.low_24h.toFixed(2)}
- Volume Ratio: ${summary.volume_ratio.toFixed(2)}x  (${summary.volume_classification})
- OBV Signal: ${summary.obv_signal}
- RSI: ${summary.rsi.toFixed(1)}  (${rsiLabel(summary.rsi)})
- MACD: ${summary.macd.toFixed(4)}  Signal: ${summary.macd_signal.toFixed(4)}
- Volatility Regime: ${summary.volatility_regime}  (${summary.volatility_warning})
- ATR: $${summary.atr.toFixed(2)}  (${summary.atr_percent.toFixed(2)}%)
- BB Width: ${summary.bb_width.toFixed(2)}%  Squeeze: ${summary.bb_squeeze_status}  Position: ${summary.bb_position}

MULTI-TIMEFRAME:
- 1H Bias: ${mtfBias.bias1h}
- 4H Bias: ${mtfBias.bias4h}  (NOTE: computed from 1h bars — Yahoo Finance has no native 4h feed)
- Daily Bias: ${mtfBias.biasDaily}
- Alignment: ${mtfBias.alignment}  (confidence: ${mtfBias.confidence})

MARKET STRUCTURE:
- Pattern: ${marketStructure.label}
- Strength: ${marketStructure.strength}

VOLUME-PRICE CORRELATION:
- Signal: ${volumePrice.signal}  (up/dn ratio: ${volumePrice.ratio.toFixed(2)}x)

RECENT PATTERNS:
${patterns}

CHART PATTERNS:
${chartPatterns.patterns.join(', ')}
Nearest Support: $${chartPatterns.nearest_support?.toFixed(2)}
Nearest Resistance: $${chartPatterns.nearest_resistance?.toFixed(2)}
Fibonacci Position: ${chartPatterns.fibonacci_position}

MACRO CONTEXT:
- Regime: ${macroContext.market_regime}
- Risk Sentiment: ${macroContext.risk_sentiment}
- SPY: ${macroContext.sp500_correlation}
- QQQ: ${macroContext.nasdaq_correlation}

NEWS:
${newsItems.join('\n')}

CROWD SENTIMENT (apply CONTRARIAN logic — see framework above):
- Fear & Greed Index : ${crowdSentiment.fear_greed?.value ?? 'N/A'} / 100  (${crowdSentiment.fear_greed?.label ?? 'N/A'})
- F&G Momentum      : ${crowdSentiment.fear_greed?.momentum ?? 'N/A'}
- StockTwits NVDA   : ${crowdSentiment.stocktwits_nvda?.bull_ratio?.toFixed(1) ?? 'N/A'}% bullish  (bulls ${crowdSentiment.stocktwits_nvda?.bullish ?? 0} · bears ${crowdSentiment.stocktwits_nvda?.bearish ?? 0} · total tagged ${crowdSentiment.stocktwits_nvda?.total_with_sentiment ?? 0})
- Overall Signals   : ${crowdSentiment.summary?.overall_signals?.join(', ') ?? 'NEUTRAL'}
- Contrarian Note   : ${buildContrarianNote(crowdSentiment)}

Provide your intraday prediction using the format:
PREDICTION: UP or DOWN
CONFIDENCE: 0-100
STRATEGY: short intraday strategy
TARGET: $price
STOP: $price
`;
}

export function buildLongTermPrompt(data: LongTermPromptData): string {
  const {
    price,
    high52w,
    low52w,
    pctFromHigh,
    pctFromLow,
    rangePos,
    sma50,
    sma200,
    aboveSma50,
    aboveSma200,
    goldenCross,
    rsi,
    atr,
    maxDrawdown,
    weeklyTrend,
    weeklyChange,
    patterns30d,
    patterns90d,
    patterns365d,
    chartPatterns,
    macroContext,
    newsItems,
  } = data;

  return `You are an expert NVDA stock analyst focused on LONG-TERM investing (3-12 month horizon).
Assess whether NVDA is a BUY, HOLD, or SELL for a long-term position.

PRICE & TREND DATA:
- Current Price: $${price.toFixed(2)}
- 52-Week High: $${high52w.toFixed(2)}  (${pctFromHigh.toFixed(1)}% from high)
- 52-Week Low:  $${low52w.toFixed(2)}   (+${pctFromLow.toFixed(1)}% from low)
- 52-Week Range Position: ${rangePos.toFixed(1)}%
- SMA-50:  ${sma50 ? '$' + sma50.toFixed(2) : 'N/A'}  (price ${aboveSma50 ? 'above ▲' : 'below ▼'})
- SMA-200: ${sma200 ? '$' + sma200.toFixed(2) : 'N/A'}  (price ${aboveSma200 ? 'above ▲' : 'below ▼'})
- Golden Cross: ${goldenCross ? 'YES (bullish)' : 'NO (bearish)'}
- RSI (14): ${rsi?.toFixed(1) ?? 'N/A'}  (${rsi ? rsiLabel(rsi) : 'N/A'})
- ATR: ${atr ? '$' + atr.toFixed(2) + ' (' + ((atr / price) * 100).toFixed(1) + '%)' : 'N/A'}
- Max Drawdown from 52w High: ${maxDrawdown.toFixed(1)}%

WEEKLY TREND (2-year):
- Direction: ${weeklyTrend}
- 2-Year Change: ${weeklyChange.toFixed(1)}%

TREND ANALYSIS:
- 30-day:  ${patterns30d}
- 90-day:  ${patterns90d}
- 1-year:  ${patterns365d}

CHART PATTERNS (daily):
${chartPatterns.patterns.join(', ')}
Key Support:    $${chartPatterns.nearest_support?.toFixed(2) ?? 'N/A'}
Key Resistance: $${chartPatterns.nearest_resistance?.toFixed(2) ?? 'N/A'}
Fibonacci Position: ${chartPatterns.fibonacci_position}

MACRO CONTEXT:
- Regime: ${macroContext.market_regime}
- Risk: ${macroContext.risk_sentiment}
- SPY: ${macroContext.sp500_correlation}
- QQQ: ${macroContext.nasdaq_correlation}

RECENT NEWS & CATALYSTS:
${newsItems.join('\n')}

Provide your long-term outlook using the format:
PREDICTION: UP or DOWN
CONFIDENCE: 0-100
STRATEGY: long-term position strategy
TARGET: $price (12-month target)
STOP: $price (long-term invalidation level)
`;
}
