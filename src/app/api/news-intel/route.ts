import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { NewsFetchService } from '@/services/news/news.fetch.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { config } from '@/config/config';

export async function POST(request: NextRequest) {
  try {
    let ticker: string | undefined;
    try {
      const body = await request.json();
      ticker = body?.ticker;
    } catch {
      // No body or invalid JSON — proceed without ticker
    }

    if (ticker) {
      try {
        config.setTicker(ticker);
      } catch {
        return errorResponse(`Unknown ticker: ${ticker}`, 400);
      }
    }

    const newsService = new NewsFetchService();
    const sentimentService = new SentimentService();

    // Fetch news and sentiment in parallel
    const [newsData, sentiment] = await Promise.all([
      newsService.fetchAll(false).catch(() => null),
      sentimentService.fetchCrowdSentiment().catch(() => null),
    ]);

    // Extract headline summaries
    const headlines = newsData?.all?.slice(0, 30).map(item => ({
      category:  item.category,
      title:     item.title,
      source:    item.source,
      impact:    item.impact,
      timestamp: item.timestamp,
      url:       item.url ?? null,
      sentiment: item.sentiment ?? null,
    })) ?? [];

    // Category breakdowns
    const categories = newsData ? {
      cryptocurrency: newsData.cryptocurrency.length,
      stocks:         newsData.stocks.length,
      economy:        newsData.economy.length,
      indonesia:      newsData.indonesia.length,
      commodities:    newsData.commodities.length,
      oil:            newsData.oil.length,
      forex:          newsData.forex.length,
    } : null;

    return jsonResponse({
      ticker: config.ticker,
      timestamp: new Date().toISOString(),
      totalHeadlines: newsData?.all?.length ?? 0,
      categories,
      headlines,
      sentiment,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


