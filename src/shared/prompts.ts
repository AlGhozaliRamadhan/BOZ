import type { MarketData, MacroContext } from '../types/types.js';
import type { ChartPatternResult } from '../analyzers/chart.analyzer.js';
import { rsiLabel } from '../utils/display.js';
import { config } from '../config/config.js';
import { formatCrowdSignalEvidence } from './evidence-attribution.js';
import { parseFxSymbol } from './fx.js';
import { buildStocktwitsPulse, stocktwitsContrarianNote } from './crowd-pulse.js';

export interface CrowdSentimentData {
  fear_greed?: {
    value?: number;
    label?: string;
    momentum?: string;
    source?: string;
    source_url?: string;
  } | null;
  stocktwits_data?: {
    bull_ratio?: number;
    bullish?: number;
    bearish?: number;
    total_with_sentiment?: number;
    total_messages?: number;
    source?: string;
    source_url?: string;
  } | null;
  social_buzz?: {
    source: string;
    mentions: number;
    top_posts?: string[];
    window?: string;
    capped?: boolean;
    source_url?: string;
  }[] | null;
  summary?: {
    overall_signals?: string[];
  } | null;
}

export interface DataFreshnessPrompt {
  latest_candle_utc: string;
  age_minutes: number;
  is_stale: boolean;
  is_incomplete: boolean;
  market_open: boolean;
  stale_threshold_minutes: number;
}

export interface IntradayPromptData {
  summary: MarketData;
  dataFreshness: DataFreshnessPrompt;
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
  dataFreshness: DataFreshnessPrompt;
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
  crowdSentiment: CrowdSentimentData;
}

function formatStocktwitsPulseLine(crowdSentiment: CrowdSentimentData): string {
  const stocktwits = crowdSentiment.stocktwits_data;
  const pulse = buildStocktwitsPulse(stocktwits ? {
    bullish: stocktwits.bullish ?? null,
    bearish: stocktwits.bearish ?? null,
    total_with_sentiment: stocktwits.total_with_sentiment ?? null,
    total_messages: stocktwits.total_messages ?? null,
    bull_ratio: stocktwits.bull_ratio ?? null,
  } : null);
  if (pulse.labelled <= 0 || pulse.bullRatio == null) return `no labelled messages (${pulse.confidenceNote})`;
  const sampled = pulse.totalMessages ?? pulse.labelled;
  return `${pulse.bullRatio.toFixed(1)}% bullish of labelled messages (bulls ${pulse.bullish} · bears ${pulse.bearish} · ${pulse.labelled} labelled of ${sampled} sampled · confidence ${pulse.confidence})`;
}

function buildContrarianNote(crowdSentiment: CrowdSentimentData): string {
  const stocktwits = crowdSentiment.stocktwits_data;
  const pulse = buildStocktwitsPulse(stocktwits ? {
    bullish: stocktwits.bullish ?? null,
    bearish: stocktwits.bearish ?? null,
    total_with_sentiment: stocktwits.total_with_sentiment ?? null,
    total_messages: stocktwits.total_messages ?? null,
    bull_ratio: stocktwits.bull_ratio ?? null,
  } : null);
  // Thin or unlabelled samples must not drive a contrarian call — the shared
  // helper already encodes that refusal plus the euphoria/fear thresholds.
  return stocktwitsContrarianNote(pulse);
}

function formatSocialBuzz(crowdSentiment: CrowdSentimentData): string {
  const buzz = crowdSentiment.social_buzz ?? [];
  if (buzz.length === 0) return 'None detected';
  return buzz
    .map((b) => {
      const top = b.top_posts && b.top_posts.length > 0
        ? ` | top: ${b.top_posts.slice(0, 3).join(' · ')}`
        : '';
      return `- ${b.source}: ${b.mentions} mentions${top}`;
    })
    .join('\n');
}

export function buildIntradayPrompt(data: IntradayPromptData): string {
  const { summary, dataFreshness, mtfBias, marketStructure, volumePrice, patterns, chartPatterns, macroContext, newsItems, crowdSentiment } = data;
  const fx = parseFxSymbol(config.ticker);
  // A pair is quoted in its own precision and never carries a dollar sign.
  const unit = fx ? '' : '$';
  const px = (value: number) => (fx ? value.toFixed(fx.precision) : value.toFixed(2));

  return `You are an expert ${config.ticker} ${fx ? 'FX' : 'stock'} trading analyst focused on INTRADAY trading.
Assess the current setup for ${config.ticker} and provide an actionable prediction for the next 2-6 hours.
${fx ? `This is the currency pair ${fx.pair}. It is a RATE, not a share price: no dollar sign, no market cap, no consolidated volume. Quote ${fx.precision} decimals and read risk in pips (1 pip = ${fx.pipSize} ${fx.quote}).\n` : ''}
CURRENT MARKET DATA:
- Current Price: ${unit}${px(summary.current_price)}
- 1H Change: ${summary.change_1h.toFixed(2)}%
- 4H Change: ${summary.change_4h.toFixed(2)}%
- 24H Change: ${summary.change_24h.toFixed(2)}%
- 24H High: ${unit}${px(summary.high_24h)}  Low: ${unit}${px(summary.low_24h)}
${fx
    ? `- Volume / OBV: not reported for FX (no consolidated tape) — judge liquidity by session instead\n`
    : `- Volume Ratio: ${summary.volume_ratio.toFixed(2)}x  (${summary.volume_classification})\n- OBV Signal: ${summary.obv_signal}\n`}- RSI: ${summary.rsi.toFixed(1)}  (${rsiLabel(summary.rsi)})
- MACD: ${summary.macd.toFixed(4)}  Signal: ${summary.macd_signal.toFixed(4)}
- Volatility Regime: ${summary.volatility_regime}  (${summary.volatility_warning})
- ATR: ${unit}${px(summary.atr)}  (${summary.atr_percent.toFixed(2)}%)
- BB Width: ${summary.bb_width.toFixed(2)}%  Squeeze: ${summary.bb_squeeze_status}  Position: ${summary.bb_position}

DATA FRESHNESS (Yahoo delayed data possible):
- Latest Candle (UTC): ${dataFreshness.latest_candle_utc}
- Age: ${dataFreshness.age_minutes.toFixed(1)} minutes  (stale threshold ${dataFreshness.stale_threshold_minutes} min)
- Stale: ${dataFreshness.is_stale ? 'YES' : 'NO'}  |  Incomplete Candle: ${dataFreshness.is_incomplete ? 'YES' : 'NO'}
- Market Open: ${dataFreshness.market_open ? 'YES' : 'NO'}

MULTI-TIMEFRAME:
- 1H Bias: ${mtfBias.bias1h}
- 4H Bias: ${mtfBias.bias4h}
- Daily Bias: ${mtfBias.biasDaily}
- Alignment: ${mtfBias.alignment}  (confidence: ${mtfBias.confidence})

MARKET STRUCTURE:
- Pattern: ${marketStructure.label}
- Strength: ${marketStructure.strength}

VOLUME-PRICE CORRELATION:
${fx ? '- Not applicable: FX quotes carry no volume. Use session liquidity and DXY context instead.' : `- Signal: ${volumePrice.signal}  (up/dn ratio: ${volumePrice.ratio.toFixed(2)}x)`}

RECENT PATTERNS:
${patterns}

CHART PATTERNS:
${chartPatterns.patterns.join(', ')}
Nearest Support: ${unit}${chartPatterns.nearest_support != null ? (fx ? px(chartPatterns.nearest_support) : chartPatterns.nearest_support.toFixed(2)) : 'N/A'}
Nearest Resistance: ${unit}${chartPatterns.nearest_resistance != null ? (fx ? px(chartPatterns.nearest_resistance) : chartPatterns.nearest_resistance.toFixed(2)) : 'N/A'}
Fibonacci Position: ${chartPatterns.fibonacci_position}

MACRO CONTEXT:
- Regime: ${macroContext.market_regime}
- Risk Sentiment: ${macroContext.risk_sentiment}
- SPY: ${macroContext.sp500_correlation}
- QQQ: ${macroContext.nasdaq_correlation}
- VIX: ${macroContext.vix_level !== null && macroContext.vix_level !== undefined ? macroContext.vix_level.toFixed(2) : 'N/A'}
- TNX (10Y): ${macroContext.tnx_yield !== null && macroContext.tnx_yield !== undefined ? macroContext.tnx_yield.toFixed(2) + '%' : 'N/A'}

NEWS:
${newsItems.join('\n')}

CROWD SENTIMENT (apply CONTRARIAN logic — see framework above):
- Fear & Greed Index : ${crowdSentiment.fear_greed?.value ?? 'N/A'} / 100  (${crowdSentiment.fear_greed?.label ?? 'N/A'})
- F&G Momentum      : ${crowdSentiment.fear_greed?.momentum ?? 'N/A'}
- StockTwits Data   : ${formatStocktwitsPulseLine(crowdSentiment)}
- Overall Signals   : ${crowdSentiment.summary?.overall_signals?.join(', ') ?? 'NEUTRAL'}
- Contrarian Note   : ${buildContrarianNote(crowdSentiment)}

SOCIAL MEDIA BUZZ:
${formatSocialBuzz(crowdSentiment)}

CROWD-SIGNAL REPORTING:
${formatCrowdSignalEvidence(crowdSentiment)}
Describe crowd data as a sourced observation, not a forecast. Name the source and sample size when available; do not call it consensus or a buy/sell signal without price and volume confirmation.

Provide your intraday prediction using the format:
PREDICTION: UP or DOWN
CONFIDENCE: 0-100
STRATEGY: short intraday strategy
TARGET: ${fx ? 'rate' : '$price'}
STOP: ${fx ? 'rate' : '$price'}
REASONS:
- reason 1 (cite data above)
- reason 2 (cite data above)
- reason 3 (cite data above)
${fx ? `
FX CONTRACTS:
- TARGET and STOP are rates, quoted to ${fx.precision} decimals and also stated in pips.
- Size the position with fx_risk_calc; call it before quoting lots, notional, margin or account risk.
- Call fx_sessions before calling the pair quiet or liquid, and say which desk is driving the move.
- Never imply execution: BOZ is research only.
` : ''}

CONTRACTS (legacy prompt path — canonical math lives in risk_calc):
- TARGET/STOP numbers must trace to deterministic tool output. Missing data is stated as missing, never estimated. The words "illustrative", "derived", "approximate", "estimated", "conditional" and "rough" create NO exemption — without validated tool output, show NO computed levels.
- Every answer carries a real likely-path table (Base + Alternative; header + '|---|---|' delimiter; columns Scenario | Trigger | Entry | Stop | TP1 | TP2 (runner) | R:R, one number per cell) and a first-person My take — even on wait days. A wait day still shows money: Base-row Entry/Stop/TP1/TP2 carry data-native potential levels, never a full row of "—". Never emit "no trade", "no-trade", or FLAT as a terminal stance; say WAIT plus the trigger, the potential path, and what you would do when it prints.
- Fresh words every run: rotate which fact leads and how the opener is entered; never recycle stock phrases ("dead on contact", "stay light", "pullback-first").
`;
}

export function buildLongTermPrompt(data: LongTermPromptData): string {
  const {
    price,
    dataFreshness,
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
    crowdSentiment,
  } = data;
  const fx = parseFxSymbol(config.ticker);
  // A pair is quoted in its own precision and never carries a dollar sign.
  const unit = fx ? '' : '$';
  const px = (value: number) => (fx ? value.toFixed(fx.precision) : value.toFixed(2));

  return `You are an expert ${config.ticker} ${fx ? 'FX' : 'stock'} analyst focused on LONG-TERM investing (3-12 month horizon).
Assess whether ${config.ticker} is a BUY, HOLD, or SELL for a long-term position.
${fx ? `This is the currency pair ${fx.pair}. It is a RATE, not a share price: no dollar sign, no market cap, no consolidated volume. Quote ${fx.precision} decimals and read risk in pips (1 pip = ${fx.pipSize} ${fx.quote}). A long-term FX view is a macro view — rate differentials, central-bank path and carry — not a company story.\n` : ''}
PRICE & TREND DATA:
- Current Price: ${unit}${px(price)}
- 52-Week High: ${unit}${px(high52w)}  (${pctFromHigh.toFixed(1)}% from high)
- 52-Week Low:  ${unit}${px(low52w)}   (+${pctFromLow.toFixed(1)}% from low)
- 52-Week Range Position: ${rangePos.toFixed(1)}%
- SMA-50:  ${sma50 ? unit + px(sma50) : 'N/A'}  (price ${aboveSma50 ? 'above ▲' : 'below ▼'})
- SMA-200: ${sma200 ? unit + px(sma200) : 'N/A'}  (price ${aboveSma200 ? 'above ▲' : 'below ▼'})
- Golden Cross: ${goldenCross ? 'YES (bullish)' : 'NO (bearish)'}
- RSI (14): ${rsi?.toFixed(1) ?? 'N/A'}  (${rsi ? rsiLabel(rsi) : 'N/A'})
- ATR: ${atr ? unit + px(atr) + ' (' + ((atr / price) * 100).toFixed(1) + '%)' : 'N/A'}
- Max Drawdown from 52w High: ${maxDrawdown.toFixed(1)}%

DATA FRESHNESS (Yahoo delayed data possible):
- Latest Candle (UTC): ${dataFreshness.latest_candle_utc}
- Age: ${dataFreshness.age_minutes.toFixed(1)} minutes  (stale threshold ${dataFreshness.stale_threshold_minutes} min)
- Stale: ${dataFreshness.is_stale ? 'YES' : 'NO'}  |  Incomplete Candle: ${dataFreshness.is_incomplete ? 'YES' : 'NO'}
- Market Open: ${dataFreshness.market_open ? 'YES' : 'NO'}

WEEKLY TREND (2-year):
- Direction: ${weeklyTrend}
- 2-Year Change: ${weeklyChange.toFixed(1)}%

TREND ANALYSIS:
- 30-day:  ${patterns30d}
- 90-day:  ${patterns90d}
- 1-year:  ${patterns365d}

CHART PATTERNS (daily):
${chartPatterns.patterns.join(', ')}
Key Support:    ${unit}${chartPatterns.nearest_support != null ? px(chartPatterns.nearest_support) : 'N/A'}
Key Resistance: ${unit}${chartPatterns.nearest_resistance != null ? px(chartPatterns.nearest_resistance) : 'N/A'}
Fibonacci Position: ${chartPatterns.fibonacci_position}

MACRO CONTEXT:
- Regime: ${macroContext.market_regime}
- Risk: ${macroContext.risk_sentiment}
- SPY: ${macroContext.sp500_correlation}
- QQQ: ${macroContext.nasdaq_correlation}
- VIX: ${macroContext.vix_level !== null && macroContext.vix_level !== undefined ? macroContext.vix_level.toFixed(2) : 'N/A'}
- TNX (10Y): ${macroContext.tnx_yield !== null && macroContext.tnx_yield !== undefined ? macroContext.tnx_yield.toFixed(2) + '%' : 'N/A'}

RECENT NEWS & CATALYSTS:
${newsItems.join('\n')}

CROWD SENTIMENT (apply CONTRARIAN logic — see framework above):
- Fear & Greed Index : ${crowdSentiment.fear_greed?.value ?? 'N/A'} / 100  (${crowdSentiment.fear_greed?.label ?? 'N/A'})
- F&G Momentum      : ${crowdSentiment.fear_greed?.momentum ?? 'N/A'}
- StockTwits Data   : ${formatStocktwitsPulseLine(crowdSentiment)}
- Overall Signals   : ${crowdSentiment.summary?.overall_signals?.join(', ') ?? 'NEUTRAL'}
- Contrarian Note   : ${buildContrarianNote(crowdSentiment)}

SOCIAL MEDIA BUZZ:
${formatSocialBuzz(crowdSentiment)}

CROWD-SIGNAL REPORTING:
${formatCrowdSignalEvidence(crowdSentiment)}
Describe crowd data as a sourced observation, not a forecast. Name the source and sample size when available; do not call it consensus or a buy/sell signal without price and volume confirmation.

Provide your long-term outlook using the format:
PREDICTION: UP or DOWN
CONFIDENCE: 0-100
STRATEGY: long-term position strategy
TARGET: ${fx ? 'rate' : '$price'} (12-month target)
STOP: ${fx ? 'rate' : '$price'} (long-term invalidation level)
REASONS:
- reason 1 (cite data above)
- reason 2 (cite data above)
- reason 3 (cite data above)
${fx ? `
FX CONTRACTS:
- TARGET and STOP are rates, quoted to ${fx.precision} decimals and also stated in pips.
- Size the position with fx_risk_calc; call it before quoting lots, notional, margin or account risk.
- Volume, OBV and market cap do not exist for a pair. Carry and rate differentials are the long-horizon drivers.
- Never imply execution: BOZ is research only.
` : ''}

CONTRACTS (legacy prompt path — canonical math lives in risk_calc):
- TARGET/STOP numbers must trace to deterministic tool output. Missing data is stated as missing, never estimated.
- If searches return nothing usable, say fundamentals are inconclusive and lower conviction. Do not force a view.
`;
}
