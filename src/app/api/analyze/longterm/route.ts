import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody, requestBodyErrorResponse } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { YahooService } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';
import { MacroService } from '@/services/market/macro.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { ChartAnalyzer } from '@/analyzers/chart.analyzer';
import { AIService } from '@/services/ai/ai.service';
import { buildTradeLevels } from '@/shared/trade-levels';
import { resolveSymbol } from '@/shared/market-constants';

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

    // Fetch 2 years of daily candles for long-term analysis
    const date = new Date();
    date.setFullYear(date.getFullYear() - 2);
    let candles = await yahoo.getHistoricalData(symbol, date, '1d', false, { adjustPrices: true });
    if (!candles.length) return errorResponse('No market data available', 404);
    candles = indicators.calculateAll(candles);

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
      fiftyTwoWeekHigh: high52w,
      fiftyTwoWeekLow: low52w,
      from52wHigh,
      from52wLow,
    };

    // Run AI analysis with long-term prompt
    const aiService = new AIService();
    const prompt = buildLongtermPrompt(symbol, last, macro, sentiment, chartPatterns, {
      high52w, low52w, from52wHigh, from52wLow,
    });
    const verdict = await aiService.analyze(prompt);

    // Build trade levels
    let tradeLevels = null;
    if (verdict.status === 'ok') {
      const action = verdict.prediction === 'UP' ? 'BUY' : verdict.prediction === 'DOWN' ? 'SELL' : 'WATCH';
      tradeLevels = buildTradeLevels(last.close, action as 'BUY' | 'SELL' | 'WATCH', verdict.confidence, '');
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
  macro: any,
  sentiment: any,
  chartPatterns: any,
  context52w: { high52w: number; low52w: number; from52wHigh: number; from52wLow: number },
): string {
  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';

  return `Analyze ${ticker} for long-term positioning (3-12 month investment horizon).

Current Price: $${fmt(last.close)}
RSI(14): ${fmt(last.RSI, 1)}
MACD: ${fmt(last.MACD, 4)} / Signal: ${fmt(last.MACD_Signal, 4)}
SMA20: ${fmt(last.SMA_20)} | SMA50: ${fmt(last.SMA_50)} | SMA200: ${fmt(last.SMA_200)}
ATR: ${fmt(last.ATR)} (${fmt(last.ATR_Percent)}%)
BB Width: ${fmt(last.BB_Width)}
Volume Ratio: ${fmt(last.Volume_Ratio)}
OBV Trend: ${last.OBV_Trend ? 'Bullish' : 'Bearish'}

52-Week Context:
- 52w High: $${fmt(context52w.high52w)} (${fmt(context52w.from52wHigh, 1)}% away)
- 52w Low: $${fmt(context52w.low52w)} (+${fmt(context52w.from52wLow, 1)}% above)

Macro Context:
- Market Regime: ${macro.market_regime}
- Risk Sentiment: ${macro.risk_sentiment}
- SPY Correlation: ${macro.sp500_correlation}
- VIX: ${macro.vix_level ?? 'N/A'}
- 10Y Treasury Yield: ${macro.tnx_yield != null ? macro.tnx_yield.toFixed(2) + '%' : 'N/A'}

Sentiment:
- Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'})
- StockTwits Bull Ratio: ${sentiment.stocktwits_data?.bull_ratio != null ? sentiment.stocktwits_data.bull_ratio.toFixed(0) + '%' : 'N/A'}

Chart Patterns (Daily): ${chartPatterns.patterns.join(', ')}
Candle Pattern: ${chartPatterns.candle_patterns.summary_text}
Fibonacci Position: ${chartPatterns.fibonacci_position}
Support: $${fmt(chartPatterns.nearest_support)}
Resistance: $${fmt(chartPatterns.nearest_resistance)}

Focus on: secular trends, institutional accumulation/distribution, macro cycle positioning, and multi-month risk/reward setups. Provide target_price for 3-6 month horizon.`;
}


