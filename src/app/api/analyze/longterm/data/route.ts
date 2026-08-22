import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { YahooService, yahooFinance } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';
import { MacroService } from '@/services/market/macro.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { ChartAnalyzer } from '@/analyzers/chart.analyzer';

const findSuggestions = async (t: string) => {
  try {
    const res = await yahooFinance.search(t, {}, { validateResult: false }) as any;
    return (res?.quotes || [])
      .filter((q: any) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'CRYPTOCURRENCY' || q.quoteType === 'INDEX'))
      .slice(0, 4)
      .map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchDisp || q.exchange,
      }));
  } catch {
    return [];
  }
};

// Step 1 of the chat longterm flow: gather market data + 52w context + macro + sentiment +
// chart patterns WITHOUT running AI. The /verdict route runs the AI on top.
export async function POST(request: NextRequest) {
  try {
    const { ticker } = await parseBody<{ ticker: string }>(request);
    if (!ticker) return errorResponse('Ticker is required', 400);

    try {
      config.setTicker(ticker);
    } catch {
      const suggestions = await findSuggestions(ticker);
      return jsonResponse({
        error: 'ticker_not_found',
        ticker,
        suggestions,
        message: suggestions.length > 0
          ? `Could not find exact ticker "${ticker}". Did you mean one of the suggested symbols?`
          : `Unknown ticker "${ticker}". Please verify the symbol.`,
      }, 404);
    }

    const yahoo = new YahooService();
    const indicators = new IndicatorsService();

    // Fetch 2 years of daily candles for long-term analysis
    const date = new Date();
    date.setFullYear(date.getFullYear() - 2);
    let candles = await yahoo.getHistoricalData(config.ticker, date, '1d', false, { adjustPrices: true });
    if (!candles.length) {
      const suggestions = await findSuggestions(ticker);
      return jsonResponse({
        error: 'ticker_not_found',
        ticker,
        suggestions,
        message: suggestions.length > 0
          ? `No candle data available for "${ticker}". Did you mean one of the suggested symbols?`
          : `No market data available for "${ticker}".`,
      }, 404);
    }
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
