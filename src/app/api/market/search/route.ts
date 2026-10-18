import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { symbolSearchService } from '@/services/market/symbol-search.service';
import { normalizeSymbolQuery, parseSymbolMarketFilter } from '@/shared/symbol-search';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query = normalizeSymbolQuery(params.get('q') ?? '');
    if (!query) return errorResponse('Missing ?q query parameter', 400);

    const page = await symbolSearchService.search(query, {
      limit: params.get('limit'),
      offset: params.get('offset'),
      market: parseSymbolMarketFilter(params.get('market')),
    });

    return jsonResponse(page);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}