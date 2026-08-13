import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { SentimentService } from '@/services/market/sentiment.service';

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (ticker) {
      try {
        config.setTicker(ticker);
      } catch {
        return errorResponse(`Unknown ticker: ${ticker}`, 400);
      }
    }

    const resolved = ticker ? config.ticker : config.ticker;
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


