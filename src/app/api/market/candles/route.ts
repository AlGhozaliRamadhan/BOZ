import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { YahooService } from '@/services/market/yahoo.service';

const VALID_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1wk'] as const;
type Interval = (typeof VALID_INTERVALS)[number];

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) return errorResponse('Missing ?ticker query parameter', 400);

    const intervalParam = request.nextUrl.searchParams.get('interval') ?? '1h';
    if (!VALID_INTERVALS.includes(intervalParam as Interval)) {
      return errorResponse(`Invalid interval. Valid: ${VALID_INTERVALS.join(', ')}`, 400);
    }
    const interval = intervalParam as Interval;

    const yahoo = new YahooService();
    const date = new Date();
    // Lookback window depends on interval
    if (interval === '1d') date.setDate(date.getDate() - 90);
    else if (interval === '1wk') date.setDate(date.getDate() - 730);
    else if (interval === '4h') date.setDate(date.getDate() - 30);
    else if (interval === '1h' || interval === '15m') date.setDate(date.getDate() - 5);
    else date.setDate(date.getDate() - 1); // 1m / 5m → single session

    const candles = await yahoo.getHistoricalData(ticker, date, interval, false);
    if (!candles.length) return errorResponse('No candle data available', 404);

    return jsonResponse({
      symbol: ticker.toUpperCase(),
      interval,
      count: candles.length,
      candles: candles.map(c => ({
        date:   c.date.toISOString(),
        open:   c.open,
        high:   c.high,
        low:    c.low,
        close:  c.close,
        volume: c.volume,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


