import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody, requestBodyErrorResponse } from '@/app/lib/api-helpers';
import { YahooService } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1wk' | '1mo';

export async function POST(request: NextRequest) {
  try {
    const { ticker, interval = '1h' } = await parseBody<{ ticker: string; interval?: Interval }>(request);
    if (!ticker) return errorResponse('Ticker is required', 400);

    const yahoo = new YahooService();
    const indicators = new IndicatorsService();

    const date = new Date();
    if (interval === '1mo') date.setFullYear(date.getFullYear() - 10);
    else if (interval === '1wk') date.setDate(date.getDate() - 800);
    else if (interval === '1d') date.setDate(date.getDate() - 420);
    else if (interval === '4h') date.setDate(date.getDate() - 30);
    else date.setDate(date.getDate() - 5);

    let candles = await yahoo.getHistoricalData(ticker, date, interval as any, false);
    if (!candles.length) return errorResponse('No market data available', 404);

    candles = indicators.calculateAll(candles);

    // Return last 50 candles with all indicators
    const enriched = candles.slice(-50).map(c => ({
      date:         c.date.toISOString(),
      open:         c.open,
      high:         c.high,
      low:          c.low,
      close:        c.close,
      volume:       c.volume,
      RSI:          c.RSI ?? null,
      MACD:         c.MACD ?? null,
      MACD_Signal:  c.MACD_Signal ?? null,
      MACD_Hist:    c.MACD_Hist ?? null,
      SMA_20:       c.SMA_20 ?? null,
      SMA_50:       c.SMA_50 ?? null,
      SMA_200:      c.SMA_200 ?? null,
      BB_High:      c.BB_High ?? null,
      BB_Low:       c.BB_Low ?? null,
      BB_Mid:       c.BB_Mid ?? null,
      BB_Width:     c.BB_Width ?? null,
      ATR:          c.ATR ?? null,
      ATR_Percent:  c.ATR_Percent ?? null,
      OBV:          c.OBV ?? null,
      OBV_Trend:    c.OBV_Trend ?? null,
      Volume_Ratio: c.Volume_Ratio ?? null,
    }));

    return jsonResponse({
      symbol: ticker.toUpperCase(),
      interval,
      count: enriched.length,
      candles: enriched,
    });
  } catch (err: unknown) {
    const bodyError = requestBodyErrorResponse(err);
    if (bodyError) return bodyError;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


