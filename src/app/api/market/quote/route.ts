import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { yahooFinance } from '@/services/market/yahoo.service';
import { resolveSymbol } from '@/shared/market-constants';
import { parseFxSymbol } from '@/shared/fx';

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) return errorResponse('Missing ?ticker query parameter', 400);

    // Normalise first: Yahoo only answers `EURUSD=X`, never the `EURUSD` or
    // `EUR/USD` spellings a user or the UI may hand us.
    const symbol = resolveSymbol(ticker) ?? ticker.trim().toUpperCase();
    const fx = parseFxSymbol(symbol);

    // Validation stays off: Yahoo's quote schema rejects whole symbols rather
    // than a single bad field, which used to 500 commodities (GC=F), FX
    // (DX-Y.NYB) and several indices (^DJI, ^IXIC) outright.
    const quote = await yahooFinance.quote(symbol, {}, { validateResult: false });
    if (!quote) return errorResponse(`No quote found for ${ticker}`, 404);

    const q = quote as any;
    const price = quote.regularMarketPrice ?? null;
    const previousClose = quote.regularMarketPreviousClose ?? null;
    const change = quote.regularMarketChange
      ?? (price != null && previousClose != null ? price - previousClose : null);

    return jsonResponse({
      symbol:              quote.symbol ?? symbol,
      name:                q.longName ?? q.shortName ?? quote.symbol,
      price,
      change,
      changePercent:       quote.regularMarketChangePercent ?? null,
      // FX has no consolidated tape. Reporting 0 would make volume signals
      // fire on a fabricated reading, so the field is explicitly empty.
      volume:              fx ? null : quote.regularMarketVolume ?? null,
      averageVolume:       fx ? null : q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? null,
      marketCap:           fx ? null : q.marketCap ?? null,
      dayHigh:             quote.regularMarketDayHigh ?? null,
      dayLow:              quote.regularMarketDayLow ?? null,
      open:                quote.regularMarketOpen ?? null,
      previousClose,
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
      // FX metadata: display form, pip size and the move expressed in pips.
      pair:                fx?.pair ?? null,
      pipSize:             fx?.pipSize ?? null,
      precision:           fx?.precision ?? null,
      changePips:          fx && change != null ? change / fx.pipSize : null,
      bid:                 fx ? q.bid ?? null : null,
      ask:                 fx ? q.ask ?? null : null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}
