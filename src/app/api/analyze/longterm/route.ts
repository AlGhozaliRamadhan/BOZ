import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody, requestBodyErrorResponse } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { YahooService } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';
import { MacroService } from '@/services/market/macro.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { ChartAnalyzer } from '@/analyzers/chart.analyzer';
import { AIService } from '@/services/ai/ai.service';
import { buildPotentialLevels } from '@/shared/trade-levels';
import { resolveSymbol } from '@/shared/market-constants';
import { parseFxSymbol, type FxPair } from '@/shared/fx';
import { sanitizeFxCandles } from '@/services/market/fx.service';
import { formatCrowdSignalEvidence } from '@/shared/evidence-attribution';
import { buildStocktwitsPulse } from '@/shared/crowd-pulse';

function formatStocktwitsPulseShort(stocktwits: any): string {
  if (!stocktwits) return 'N/A';
  const pulse = buildStocktwitsPulse({
    bullish: stocktwits.bullish ?? null,
    bearish: stocktwits.bearish ?? null,
    total_with_sentiment: stocktwits.total_with_sentiment ?? null,
    total_messages: stocktwits.total_messages ?? null,
    bull_ratio: stocktwits.bull_ratio,
  });
  if (pulse.bullRatio == null || pulse.labelled <= 0) return 'no audited read';
  return `${pulse.bullRatio.toFixed(0)}% bullish of ${pulse.labelled} labelled (confidence ${pulse.confidence})`;
}

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await parseBody<{ ticker: string }>(request);
    if (!ticker) return errorResponse('Ticker is required', 400);

    const symbol = resolveSymbol(ticker);
    if (!symbol) {
      return errorResponse(`Unknown ticker: ${ticker}`, 400);
    }

    const yahoo = new YahooService();
    const indicators = new IndicatorsService();
    const pair = parseFxSymbol(symbol);

    // Fetch 2 years of daily candles for long-term analysis
    const date = new Date();
    date.setFullYear(date.getFullYear() - 2);
    const rawCandles = await yahoo.getHistoricalData(symbol, date, '1d', false, { adjustPrices: !pair });
    const sourcedCandles = pair ? sanitizeFxCandles(rawCandles, '1d') : rawCandles;
    if (!sourcedCandles.length) return errorResponse('No market data available', 404);
    const candles = indicators.calculateAll(sourcedCandles);
    if (pair) {
      // FX has no tape. Clearing both fields keeps the prompt and the dashboard
      // from presenting a fabricated volume/OBV observation.
      const lastCandle = candles.at(-1);
      if (lastCandle) {
        lastCandle.Volume_Ratio = undefined;
        lastCandle.OBV_Trend = undefined;
      }
    }

    // Parallel fetches
    const macroService = new MacroService();
    const sentimentService = new SentimentService();
    const chartAnalyzer = new ChartAnalyzer();

    const [macro, sentiment, chartPatterns] = await Promise.all([
      macroService.getMacroContext(symbol),
      sentimentService.fetchCrowdSentiment(symbol),
      Promise.resolve(chartAnalyzer.analyzeChartPatterns(candles)),
    ]);

    // Build long-term market data from last candle
    const last = candles[candles.length - 1];
    const high52w = Math.max(...candles.slice(-252).map(c => c.high));
    const low52w = Math.min(...candles.slice(-252).map(c => c.low));
    const from52wHigh = high52w > 0 ? ((last.close - high52w) / high52w) * 100 : 0;
    const from52wLow = low52w > 0 ? ((last.close - low52w) / low52w) * 100 : 0;

    const marketData = {
      current_price: last.close,
      rsi: last.RSI ?? null,
      macd: last.MACD ?? null,
      macd_signal: last.MACD_Signal ?? null,
      sma_20: last.SMA_20 ?? null,
      sma_50: last.SMA_50 ?? null,
      sma_200: last.SMA_200 ?? null,
      atr: last.ATR ?? null,
      atr_percent: last.ATR_Percent ?? null,
      bb_width: last.BB_Width ?? null,
      volume_ratio: last.Volume_Ratio ?? null,
      obv_trend: last.OBV_Trend ?? null,
      pair: pair?.pair ?? null,
      pip_size: pair?.pipSize ?? null,
      precision: pair?.precision ?? null,
      fiftyTwoWeekHigh: high52w,
      fiftyTwoWeekLow: low52w,
      from52wHigh,
      from52wLow,
    };

    // Run AI analysis with long-term prompt
    const aiService = new AIService();
    const prompt = buildLongtermPrompt(symbol, last, pair, macro, sentiment, chartPatterns, {
      high52w, low52w, from52wHigh, from52wLow,
    });
    const verdict = await aiService.analyze(prompt);

    // Legacy levels (fixed-percentage math). Canonical math is risk_calc
    // in shared/risk-math.ts. Always emit a potential envelope — even on
    // WATCH / uncertain / error — so the UI still shows where price could
    // go instead of hiding money values. WATCH envelopes are flagged
    // isPotential so the UI can label them "wait, not a trigger".
    const verdictLean = verdict as { prediction?: 'UP' | 'DOWN' | 'UNKNOWN'; confidence?: number };
    const tradeLevels = buildPotentialLevels(
      last.close ?? null,
      verdict.status === 'ok' ? verdict.prediction : (verdictLean.prediction ?? 'UNKNOWN'),
      verdict.status === 'ok' ? verdict.confidence : (verdictLean.confidence ?? 50),
      '',
    );
    if (verdict.status !== 'ok') {
      tradeLevels.isPotential = true;
    }

    return jsonResponse({
      ticker: symbol,
      timestamp: new Date().toISOString(),
      horizon: '3-12 months',
      verdict,
      marketData,
      macro,
      sentiment,
      chartPatterns,
      tradeLevels,
    });
  } catch (err: unknown) {
    const bodyError = requestBodyErrorResponse(err);
    if (bodyError) return bodyError;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}

// ── Build long-term analysis prompt ──────────────────────────────────────────

function buildLongtermPrompt(
  ticker: string,
  last: any,
  pair: FxPair | null,
  macro: any,
  sentiment: any,
  chartPatterns: any,
  context52w: { high52w: number; low52w: number; from52wHigh: number; from52wLow: number },
): string {
  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';
  // A pair is a rate: own precision, no dollar sign, and no volume story.
  const px = (v: number | null | undefined, decimals = pair ? pair.precision : 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';
  const unit = pair ? '' : '$';
  const flowLine = pair
    ? 'Institutional Flow & Volatility: OBV Trend: not applicable | Volume Ratio: not reported for FX'
    : `Institutional Flow & Volatility: OBV Trend: ${last.OBV_Trend ? 'Accumulation' : 'Distribution'} | Volume Ratio: ${fmt(last.Volume_Ratio)}x`;

  return `Analyze ${ticker}${pair ? ` (${pair.pair})` : ''} for long-term positioning (3-12 month investment horizon).

Current Price: ${unit}${px(last.close)}
RSI(14): ${fmt(last.RSI, 1)}
MACD: ${fmt(last.MACD, 4)} / Signal: ${fmt(last.MACD_Signal, 4)}
SMA20: ${unit}${px(last.SMA_20)} | SMA50: ${unit}${px(last.SMA_50)} | SMA200: ${unit}${px(last.SMA_200)}
ATR: ${unit}${px(last.ATR)} (${fmt(last.ATR_Percent)}%)
BB Width: ${fmt(last.BB_Width)}
${flowLine}

52-Week Context:
- 52w High: ${unit}${px(context52w.high52w)} (${fmt(context52w.from52wHigh, 1)}% away)
- 52w Low: ${unit}${px(context52w.low52w)} (+${fmt(context52w.from52wLow, 1)}% above)

Macro Context:
- Market Regime: ${macro.market_regime}
- Risk Sentiment: ${macro.risk_sentiment}
- SPY Correlation: ${macro.sp500_correlation}
- VIX: ${macro.vix_level ?? 'N/A'}
- 10Y Treasury Yield: ${macro.tnx_yield != null ? macro.tnx_yield.toFixed(2) + '%' : 'N/A'}

Sentiment:
- Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'})
- StockTwits Bull Ratio: ${formatStocktwitsPulseShort(sentiment.stocktwits_data)}
- Crowd evidence: ${formatCrowdSignalEvidence(sentiment) || 'No source-attributed crowd signal was available.'}

Chart Patterns (Daily): ${chartPatterns.patterns.join(', ')}
Candle Pattern: ${chartPatterns.candle_patterns.summary_text}
Fibonacci Position: ${chartPatterns.fibonacci_position}
Support: ${unit}${px(chartPatterns.nearest_support)}
Resistance: ${unit}${px(chartPatterns.nearest_resistance)}

Focus on: ${pair
    ? `rate differentials, central-bank path, carry and the macro cycle for ${pair.pair}; a pair is a rate quoted to ${pair.precision} decimals with a pip of ${pair.pipSize} ${pair.quote}. State risk in pips, not dollars.`
    : 'secular trends, institutional accumulation/distribution, macro cycle positioning, and multi-month risk/reward setups.'} Do not invent price targets: state missing inputs as missing, and if there is no clean setup say so with what you would need to see.${pair ? `

Never imply execution — BOZ is research only.` : ''}`;
}


