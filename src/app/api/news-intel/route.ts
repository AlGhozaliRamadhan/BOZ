import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody, requestBodyErrorResponse } from '@/app/lib/api-helpers';
import { NewsFetchService } from '@/services/news/news.fetch.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { config } from '@/config/config';
import { resolveSymbol } from '@/shared/market-constants';

export async function POST(request: NextRequest) {
  try {
    const body = request.body ? await parseBody<unknown>(request) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse('Request body must be an object', 400);
    const requestedTicker = (body as Record<string, unknown>).ticker;
    if (requestedTicker !== undefined && typeof requestedTicker !== 'string') return errorResponse('Ticker must be a string', 400);
    const ticker = typeof requestedTicker === 'string' ? resolveSymbol(requestedTicker) : config.ticker;
    if (!ticker) return errorResponse(`Unknown ticker: ${requestedTicker}`, 400);

    const newsService = new NewsFetchService();
    const sentimentService = new SentimentService();

    // Fetch news and sentiment in parallel
    const [newsData, sentiment] = await Promise.all([
      newsService.fetchAll(false).catch(() => null),
      sentimentService.fetchCrowdSentiment(ticker).catch(() => null),
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

    // Generate AI intelligence thought deductions from news headlines and crowd sentiment
    const thoughts: string[] = [];
    const fg = sentiment?.fear_greed;
    if (fg) {
      thoughts.push(`[SENTIMENT DEDUCTION] Fear & Greed Index at ${fg.value} (${fg.label}). ${fg.value > 75 ? 'Extreme Greed warrants contrarian caution against chase buying.' : fg.value < 25 ? 'Extreme Fear presents high-asymmetry accumulation setups.' : 'Neutral sentiment indicates balanced market participation.'}`);
    }
    const st = sentiment?.stocktwits_data;
    if (st && st.bull_ratio !== undefined) {
      thoughts.push(`[CROWD CONTRARIAN] Retail sentiment is ${st.bull_ratio.toFixed(0)}% bullish across ${st.total_with_sentiment} measured posts. ${st.bull_ratio > 70 ? 'Retail euphoria detected — high probability of liquidity sweep / pullback.' : st.bull_ratio < 30 ? 'Retail panic detected — upside bounce potential elevated.' : 'Healthy retail distribution without euphoric skew.'}`);
    }
    if (sentiment?.summary?.overall_signals?.length) {
      thoughts.push(`[MACRO THEME SIGNALS] Key cross-asset drivers: ${sentiment.summary.overall_signals.join(' · ')}`);
    }
    if (headlines.length > 0) {
      const topCatalysts = headlines.slice(0, 3).map(h => `"${h.title}" (${h.source})`).join('; ');
      thoughts.push(`[BREAKING CATALYSTS] Lead market movers: ${topCatalysts}`);
    }

    return jsonResponse({
      ticker,
      timestamp: new Date().toISOString(),
      totalHeadlines: newsData?.all?.length ?? 0,
      categories,
      headlines,
      sentiment,
      thoughts,
      thought: thoughts.join('\n\n'),
    });
  } catch (err: unknown) {
    const bodyError = requestBodyErrorResponse(err);
    if (bodyError) return bodyError;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


