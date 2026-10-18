import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { yahooFinance } from '@/services/market/yahoo.service';

/** Batch ceiling for one request. Yahoo throttles well before this. */
const MAX_BATCH_TICKERS = 40;

const QUOTE_FIELDS = [
  'symbol', 'shortName', 'longName', 'regularMarketPrice',
  'regularMarketChange', 'regularMarketChangePercent',
  'regularMarketVolume', 'marketState', 'quoteType', 'currency',
] as unknown as string[];

export interface BatchQuote {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketState: string | null;
  currency: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get('tickers') ?? '';
    const tickers = [...new Set(
      raw.split(',')
        .map(ticker => ticker.trim().toUpperCase())
        .filter(ticker => /^[\^]?[A-Z0-9.=^/-]{1,20}$/.test(ticker)),
    )].slice(0, MAX_BATCH_TICKERS);

    if (tickers.length === 0) return errorResponse('Missing ?tickers query parameter', 400);

    // Validation is a module option, not a query option: the `return: 'array'`
// query schema rejects unknown keys, so it goes in the third argument. Without
// it Yahoo's schema 500s the whole batch on a commodity or FX symbol.
const response = await yahooFinance.quote(
      tickers,
      { return: 'array', fields: QUOTE_FIELDS } as never,
      { validateResult: false },
    ) as unknown;

    const rows = Array.isArray(response) ? response : [];
    const quotes: BatchQuote[] = rows
      .filter((row): row is Record<string, unknown> => !!row && typeof row.symbol === 'string')
      .map(row => {
        const symbol = String(row.symbol).toUpperCase();
        return {
          symbol,
          name: String(row.longName ?? row.shortName ?? symbol),
          price: typeof row.regularMarketPrice === 'number' ? row.regularMarketPrice : null,
          change: typeof row.regularMarketChange === 'number' ? row.regularMarketChange : null,
          changePercent: typeof row.regularMarketChangePercent === 'number' ? row.regularMarketChangePercent : null,
          volume: typeof row.regularMarketVolume === 'number' ? row.regularMarketVolume : null,
          marketState: typeof row.marketState === 'string' ? row.marketState : null,
          currency: typeof row.currency === 'string' ? row.currency : null,
        };
      });

    return jsonResponse({ quotes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}