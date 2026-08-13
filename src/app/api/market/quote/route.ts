import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { yahooFinance } from '@/services/market/yahoo.service';

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) return errorResponse('Missing ?ticker query parameter', 400);

    const quote = await yahooFinance.quote(ticker);
    if (!quote) return errorResponse(`No quote found for ${ticker}`, 404);

    const q = quote as any;
    return jsonResponse({
      symbol:              quote.symbol ?? ticker,
      name:                q.longName ?? q.shortName ?? quote.symbol,
      price:               quote.regularMarketPrice ?? null,
      change:              quote.regularMarketChange ?? null,
      changePercent:       quote.regularMarketChangePercent ?? null,
      volume:              quote.regularMarketVolume ?? null,
      averageVolume:       q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? null,
      marketCap:           q.marketCap ?? null,
      dayHigh:             quote.regularMarketDayHigh ?? null,
      dayLow:              quote.regularMarketDayLow ?? null,
      open:                quote.regularMarketOpen ?? null,
      previousClose:       quote.regularMarketPreviousClose ?? null,
      fiftyTwoWeekHigh:    quote.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow:     quote.fiftyTwoWeekLow ?? null,
      marketState:         q.marketState ?? null,
      quoteType:           q.quoteType ?? q.typeDisp ?? null,
      exchange:            q.fullExchangeName ?? q.exchange ?? null,
      currency:            q.currency ?? null,
      trailingPE:          q.trailingPE ?? null,
      forwardPE:           q.forwardPE ?? null,
      epsTrailingTwelveMonths: q.epsTrailingTwelveMonths ?? null,
      regularMarketTime:   q.regularMarketTime ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


