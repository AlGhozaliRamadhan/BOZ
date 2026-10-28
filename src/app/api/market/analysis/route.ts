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
import { parseFxSymbol } from '@/shared/fx';
import { fxService, sanitizeFxCandles } from '@/services/market/fx.service';

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (!ticker) return errorResponse('Missing ?ticker query parameter', 400);

    const symbol = resolveSymbol(ticker);
    if (!symbol) {
      return errorResponse(`Unknown ticker: ${ticker}`, 400);
    }
    const pair = parseFxSymbol(symbol);
    const yahoo = new YahooService();
    const indicators = new IndicatorsService();
    const chartAnalyzer = new ChartAnalyzer();
    const macroService = new MacroService();
    const sentimentService = new SentimentService();
    const newsService = new NewsService();

    const from = new Date();
    from.setDate(from.getDate() - 420);

    const [candlesRaw, quoteRaw, macro, sentiment, headlines, fx] = await Promise.all([
      yahoo.getHistoricalData(symbol, from, '1d', false, { adjustPrices: !pair }),
      // Validation off so commodities/FX/indices still populate the snapshot.
      yahooFinance.quote(symbol, {}, { validateResult: false }).catch(() => null),
      macroService.getMacroContext(symbol).catch(() => null),
      sentimentService.fetchCrowdSentiment(symbol).catch(() => null),
      // A pair reads better as "EUR/USD" than as "EURUSD=X" in a news query.
      newsService.getStockNews(pair ? pair.pair : symbol).catch(() => [] as string[]),
      pair ? fxService.getContext(symbol).catch(() => null) : Promise.resolve(null),
    ]);

    if (!candlesRaw.length) return errorResponse('No market data available', 404);

    const source = pair ? sanitizeFxCandles(candlesRaw, '1d') : candlesRaw;
    if (!source.length) return errorResponse('No market data available', 404);
    const candles = indicators.calculateAll(source);
    if (pair) {
      // Volume and OBV are meaningless without a tape. Clearing them here stops
      // buildDashboardAnalysis from emitting participation signals for FX.
      const last = candles.at(-1);
      if (last) {
        last.Volume_Ratio = undefined;
        last.OBV_Trend = undefined;
      }
    }
    const patterns = chartAnalyzer.analyzeChartPatterns(candles);
    const q = quoteRaw as any;
    const quote: QuoteSnapshot = {
      name: q?.longName ?? q?.shortName ?? symbol,
      marketCap: pair ? null : q?.marketCap ?? null,
      fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
      previousClose: q?.regularMarketPreviousClose ?? null,
      marketState: q?.marketState ?? null,
      quoteType: q?.quoteType ?? q?.typeDisp ?? null,
      exchange: q?.fullExchangeName ?? q?.exchange ?? null,
      currency: q?.currency ?? null,
      averageVolume: pair ? null : q?.averageDailyVolume3Month ?? q?.averageDailyVolume10Day ?? null,
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
        volume: pair ? null : q?.regularMarketVolume ?? null,
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
        trailingPE: pair ? null : q?.trailingPE ?? null,
        regularMarketTime: q?.regularMarketTime ?? null,
        pair: pair?.pair ?? null,
        pipSize: pair?.pipSize ?? null,
        precision: pair?.precision ?? null,
        bid: pair ? q?.bid ?? null : null,
        ask: pair ? q?.ask ?? null : null,
      },
      analysis,
      macro,
      sentiment,
      // FX extras: session clock, rate book and cross rates. Null off-FX so
      // non-pair pages keep their existing payload exactly.
      fx,
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
