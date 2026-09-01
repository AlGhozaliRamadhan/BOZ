import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { YahooService, yahooFinance } from '@/services/market/yahoo.service';
import { IndicatorsService } from '@/services/market/indicators.service';
import { MacroService } from '@/services/market/macro.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { NewsService } from '@/services/news/news.service';
import { ChartAnalyzer } from '@/analyzers/chart.analyzer';
import {
  buildDashboardAnalysis,
  scoreHeadlines,
  type QuoteSnapshot,
} from '@/shared/dashboard-analysis';
import { resolveSymbol } from '@/shared/market-constants';

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) return errorResponse('Missing ?ticker query parameter', 400);

    const symbol = resolveSymbol(ticker);
    if (!symbol) {
      return errorResponse(`Unknown ticker: ${ticker}`, 400);
    }
    const yahoo = new YahooService();
    const indicators = new IndicatorsService();
    const chartAnalyzer = new ChartAnalyzer();
    const macroService = new MacroService();
    const sentimentService = new SentimentService();
    const newsService = new NewsService();

    const from = new Date();
    from.setDate(from.getDate() - 420);

    const [candlesRaw, quoteRaw, macro, sentiment, headlines] = await Promise.all([
      yahoo.getHistoricalData(symbol, from, '1d', false, { adjustPrices: true }),
      yahooFinance.quote(symbol).catch(() => null),
      macroService.getMacroContext(symbol).catch(() => null),
      sentimentService.fetchCrowdSentiment(symbol).catch(() => null),
      newsService.getStockNews(symbol).catch(() => [] as string[]),
    ]);

    if (!candlesRaw.length) return errorResponse('No market data available', 404);

    const candles = indicators.calculateAll(candlesRaw);
    const patterns = chartAnalyzer.analyzeChartPatterns(candles);
    const q = quoteRaw as any;
    const quote: QuoteSnapshot = {
      name: q?.longName ?? q?.shortName ?? symbol,
      marketCap: q?.marketCap ?? null,
      fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
      previousClose: q?.regularMarketPreviousClose ?? null,
      marketState: q?.marketState ?? null,
      quoteType: q?.quoteType ?? q?.typeDisp ?? null,
      exchange: q?.fullExchangeName ?? q?.exchange ?? null,
      currency: q?.currency ?? null,
      averageVolume: q?.averageDailyVolume3Month ?? q?.averageDailyVolume10Day ?? null,
    };

    const analysis = buildDashboardAnalysis({ ticker: symbol, candles, quote, patterns });
    const newsScore = scoreHeadlines(headlines.filter(h => h && !h.startsWith('No significant')));

    return jsonResponse({
      ticker: symbol,
      timestamp: new Date().toISOString(),
      quote: {
        symbol,
        name: quote.name,
        price: q?.regularMarketPrice ?? analysis.structure.price,
        change: q?.regularMarketChange ?? null,
        changePercent: q?.regularMarketChangePercent ?? null,
        volume: q?.regularMarketVolume ?? null,
        averageVolume: quote.averageVolume,
        marketCap: quote.marketCap,
        dayHigh: q?.regularMarketDayHigh ?? null,
        dayLow: q?.regularMarketDayLow ?? null,
        open: q?.regularMarketOpen ?? null,
        previousClose: quote.previousClose,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        marketState: quote.marketState,
        quoteType: quote.quoteType,
        exchange: quote.exchange,
        currency: quote.currency,
        trailingPE: q?.trailingPE ?? null,
        regularMarketTime: q?.regularMarketTime ?? null,
      },
      analysis,
      macro,
      sentiment,
      news: {
        headlines: headlines.slice(0, 6),
        sentiment: newsScore.sentiment,
        hits: newsScore.hits,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}
