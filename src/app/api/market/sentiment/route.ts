import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { SentimentService } from '@/services/market/sentiment.service';
import { resolveSymbol } from '@/shared/market-constants';

export async function GET(request: NextRequest) {
  try {
    const requestedTicker = request.nextUrl.searchParams.get('ticker');
    const resolved = requestedTicker ? resolveSymbol(requestedTicker) : config.ticker;
    if (!resolved) return errorResponse(`Unknown ticker: ${requestedTicker}`, 400);
    const sentimentService = new SentimentService();
    const sentiment = await sentimentService.fetchCrowdSentiment(resolved);

    return jsonResponse({
      ticker: resolved,
      timestamp: new Date().toISOString(),
      ...sentiment,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


