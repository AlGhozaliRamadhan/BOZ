import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { yahooFinance } from '@/services/market/yahoo.service';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q');
    if (!q) return errorResponse('Missing ?q query parameter', 400);

    // Disable strict JSON schema validation to prevent crashes when Yahoo changes their API slightly
    const results = await yahooFinance.search(q, {}, { validateResult: false }) as any;
    
    // Map to a simpler structure, filtering out news and non-equity items if desired
    // For now, let's just return the top quotes
    const quotes = (results.quotes || []).map((quote: any) => ({
      symbol: quote.symbol,
      name: quote.shortname || quote.longname || quote.symbol,
      exchange: quote.exchDisp || quote.exchange,
      type: quote.quoteType,
    }));

    return jsonResponse(quotes);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}
