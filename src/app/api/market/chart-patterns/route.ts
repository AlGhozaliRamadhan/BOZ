import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody } from '@/app/lib/api-helpers';
import { YahooService } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';
import { ChartAnalyzer } from '@/analyzers/chart.analyzer';

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await parseBody<{ ticker: string }>(request);
    if (!ticker) return errorResponse('Ticker is required', 400);

    const yahoo = new YahooService();
    const indicators = new IndicatorsService();
    const chartAnalyzer = new ChartAnalyzer();

    // Fetch 5 days of 1h candles for chart pattern detection
    const date = new Date();
    date.setDate(date.getDate() - 5);

    let candles = await yahoo.getHistoricalData(ticker, date, '1h', false);
    if (!candles.length) return errorResponse('No market data available', 404);

    candles = indicators.calculateAll(candles);
    const chartPatterns = chartAnalyzer.analyzeChartPatterns(candles);

    return jsonResponse({
      ticker: ticker.toUpperCase(),
      timestamp: new Date().toISOString(),
      ...chartPatterns,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


