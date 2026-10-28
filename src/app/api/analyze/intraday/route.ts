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

    // Fetch 1h candles (5 days)
    const date = new Date();
    date.setDate(date.getDate() - 5);
    const rawCandles = await yahoo.getHistoricalData(symbol, date, '1h', false);
    const sourcedCandles = pair ? sanitizeFxCandles(rawCandles, '1h') : rawCandles;
    if (!sourcedCandles.length) return errorResponse('No market data available', 404);
    const candles = indicators.calculateAll(sourcedCandles);
    if (pair) {
      // No consolidated tape for a pair: clearing these stops the prompt and
      // the dashboard from reporting a fabricated volume/OBV read.
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

    // Build market summary from last candle
    const last = candles[candles.length - 1];
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
    };

    // Run AI analysis
    const aiService = new AIService();
    const prompt = buildIntradayPrompt(symbol, last, pair, macro, sentiment, chartPatterns);
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

// ── Build a concise analysis prompt ──────────────────────────────────────────

function buildIntradayPrompt(
  ticker: string,
  last: any,
  pair: FxPair | null,
  macro: any,
  sentiment: any,
  chartPatterns: any,
): string {
  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';
  // A pair is a rate: own precision, no dollar sign, and no volume story.
  const px = (v: number | null | undefined, decimals = pair ? pair.precision : 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';
  const unit = pair ? '' : '$';
  const volumeLine = pair
    ? 'Volume Ratio: not reported for FX | OBV Trend: not applicable'
    : `Volume Ratio: ${fmt(last.Volume_Ratio)} | OBV Trend: ${last.OBV_Trend ? 'Bullish' : 'Bearish'}`;

  return `Analyze ${ticker}${pair ? ` (${pair.pair})` : ''} for intraday trading (2-6 hour horizon).

Current Price: ${unit}${px(last.close)}
RSI(14): ${fmt(last.RSI, 1)}
MACD: ${fmt(last.MACD, 4)} / Signal: ${fmt(last.MACD_Signal, 4)}
SMA20: ${unit}${px(last.SMA_20)} | SMA50: ${unit}${px(last.SMA_50)}
ATR: ${unit}${px(last.ATR)} (${fmt(last.ATR_Percent)}%)
BB Width: ${fmt(last.BB_Width)}
${volumeLine}

Macro Context:
- Market Regime: ${macro.market_regime}
- Risk Sentiment: ${macro.risk_sentiment}
- SPY Correlation: ${macro.sp500_correlation}
- VIX: ${macro.vix_level ?? 'N/A'}

Sentiment:
- Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'})
- StockTwits Bull Ratio: ${formatStocktwitsPulseShort(sentiment.stocktwits_data)}
- Crowd evidence: ${formatCrowdSignalEvidence(sentiment) || 'No source-attributed crowd signal was available.'}

Chart Patterns: ${chartPatterns.patterns.join(', ')}
Candle Pattern: ${chartPatterns.candle_patterns.summary_text}
Fibonacci Position: ${chartPatterns.fibonacci_position}
Nearest Support: ${unit}${px(chartPatterns.nearest_support)}
Nearest Resistance: ${unit}${px(chartPatterns.nearest_resistance)}${pair ? `

FX note: ${pair.pair} is a rate quoted to ${pair.precision} decimals; one pip is ${pair.pipSize} ${pair.quote}. State risk in pips, not dollars, and never imply execution — BOZ is research only.` : ''}`;
}


