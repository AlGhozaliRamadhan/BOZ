import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { YahooService } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';
import { MacroService } from '@/services/market/macro.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { ChartAnalyzer } from '@/analyzers/chart.analyzer';
import { AIService } from '@/services/ai/ai.service';
import { buildTradeLevels } from '@/shared/trade-levels';

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await parseBody<{ ticker: string }>(request);
    if (!ticker) return errorResponse('Ticker is required', 400);

    try {
      config.setTicker(ticker);
    } catch {
      return errorResponse(`Unknown ticker: ${ticker}`, 400);
    }

    const yahoo = new YahooService();
    const indicators = new IndicatorsService();

    // Fetch 1h candles (5 days)
    const date = new Date();
    date.setDate(date.getDate() - 5);
    let candles = await yahoo.getHistoricalData(config.ticker, date, '1h', false);
    if (!candles.length) return errorResponse('No market data available', 404);
    candles = indicators.calculateAll(candles);

    // Parallel fetches
    const macroService = new MacroService();
    const sentimentService = new SentimentService();
    const chartAnalyzer = new ChartAnalyzer();

    const [macro, sentiment, chartPatterns] = await Promise.all([
      macroService.getMacroContext(),
      sentimentService.fetchCrowdSentiment(),
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
    };

    // Run AI analysis
    const aiService = new AIService();
    const prompt = buildIntradayPrompt(config.ticker, last, macro, sentiment, chartPatterns);
    const verdict = await aiService.analyze(prompt);

    // Build trade levels if verdict is ok
    let tradeLevels = null;
    if (verdict.status === 'ok') {
      const action = verdict.prediction === 'UP' ? 'BUY' : verdict.prediction === 'DOWN' ? 'SELL' : 'WATCH';
      tradeLevels = buildTradeLevels(last.close, action as 'BUY' | 'SELL' | 'WATCH', verdict.confidence, '');
    }

    return jsonResponse({
      ticker: config.ticker,
      timestamp: new Date().toISOString(),
      verdict,
      marketData,
      macro,
      sentiment,
      chartPatterns,
      tradeLevels,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}

// ── Build a concise analysis prompt ──────────────────────────────────────────

function buildIntradayPrompt(
  ticker: string,
  last: any,
  macro: any,
  sentiment: any,
  chartPatterns: any,
): string {
  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';

  return `Analyze ${ticker} for intraday trading (2-6 hour horizon).

Current Price: $${fmt(last.close)}
RSI(14): ${fmt(last.RSI, 1)}
MACD: ${fmt(last.MACD, 4)} / Signal: ${fmt(last.MACD_Signal, 4)}
SMA20: ${fmt(last.SMA_20)} | SMA50: ${fmt(last.SMA_50)}
ATR: ${fmt(last.ATR)} (${fmt(last.ATR_Percent)}%)
BB Width: ${fmt(last.BB_Width)}
Volume Ratio: ${fmt(last.Volume_Ratio)}
OBV Trend: ${last.OBV_Trend ? 'Bullish' : 'Bearish'}

Macro Context:
- Market Regime: ${macro.market_regime}
- Risk Sentiment: ${macro.risk_sentiment}
- SPY Correlation: ${macro.sp500_correlation}
- VIX: ${macro.vix_level ?? 'N/A'}

Sentiment:
- Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'})
- StockTwits Bull Ratio: ${sentiment.stocktwits_data?.bull_ratio != null ? sentiment.stocktwits_data.bull_ratio.toFixed(0) + '%' : 'N/A'}

Chart Patterns: ${chartPatterns.patterns.join(', ')}
Candle Pattern: ${chartPatterns.candle_patterns.summary_text}
Fibonacci Position: ${chartPatterns.fibonacci_position}
Nearest Support: $${fmt(chartPatterns.nearest_support)}
Nearest Resistance: $${fmt(chartPatterns.nearest_resistance)}`;
}


