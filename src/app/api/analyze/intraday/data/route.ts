import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { YahooService } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';
import { MacroService } from '@/services/market/macro.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { ChartAnalyzer } from '@/analyzers/chart.analyzer';

// Step 1 of the chat intraday flow: gather market data + macro + sentiment +
// chart patterns WITHOUT running AI. The /verdict route runs the AI on top.
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
      // Full candle with all indicator fields — required by the /verdict route
      lastCandleFull: last,
    };

    return jsonResponse({
      ticker: config.ticker,
      timestamp: new Date().toISOString(),
      marketData,
      macro,
      sentiment,
      chartPatterns,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}
