import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { yahooFinance } from '@/services/market/yahoo.service';

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) return errorResponse('Missing ?ticker query parameter', 400);

    const quote = await yahooFinance.quote(ticker);
    if (!quote) return errorResponse(`No quote found for ${ticker}`, 404);

    return jsonResponse({
      symbol:              quote.symbol ?? ticker,
      name:                (quote as any).longName ?? (quote as any).shortName ?? quote.symbol,
      price:               quote.regularMarketPrice ?? null,
      change:              quote.regularMarketChange ?? null,
      changePercent:       quote.regularMarketChangePercent ?? null,
      volume:              quote.regularMarketVolume ?? null,
      marketCap:           (quote as any).marketCap ?? null,
      dayHigh:             quote.regularMarketDayHigh ?? null,
      dayLow:              quote.regularMarketDayLow ?? null,
      open:                quote.regularMarketOpen ?? null,
      previousClose:       quote.regularMarketPreviousClose ?? null,
      fiftyTwoWeekHigh:    quote.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow:     quote.fiftyTwoWeekLow ?? null,
      marketState:         (quote as any).marketState ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


