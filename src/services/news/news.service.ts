import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { log } from '../../utils/logger.js';
import { newsFetchService } from './news.fetch.service.js';
import { webSearchService } from '../search/web.search.service.js';

export class NewsService {
  async getStockNews(symbol: string): Promise<string[]> {
    const newsItems: string[] = [];
    const seenTitles = new Set<string>();

    const isIndonesian = symbol.toUpperCase().endsWith('.JK') || /^(BBCA|BBRI|BMRI|BBNI|TLKM|ASII|GOTO|ANTM|INCO|ADRO|UNTR|ICBP|INDF|KLBF|PGAS|PTBA|MDKA|AMMN)/i.test(symbol);

    // Three independent sources, each with its own failure mode. They used to
    // be awaited in sequence, so a slow vendor added its full timeout to the
    // other two; now they overlap and the merge below keeps the original order
    // (and therefore the original dedupe winner) intact.
    const [directTitles, vendorTitles, extraTitles] = await Promise.all([
      this.collectTickerRss(symbol),
      this.collectYahooNews(symbol),
      this.collectExtraNews(symbol, isIndonesian),
    ]);

    for (const line of [...directTitles, ...vendorTitles, ...extraTitles]) {
      const normalized = line.title.trim().toLowerCase();
      if (seenTitles.has(normalized)) continue;
      seenTitles.add(normalized);
      newsItems.push(line.formatted);
    }

    // Fallback: If still under 3 news items, query the live web-news providers.
    if (newsItems.length < 3) {
      try {
        const ddgQuery = `${symbol.replace(/\.JK$/i, '')} stock news earnings catalysts`;
        const ddgText = await webSearchService.search(ddgQuery);
        const ddgLines = ddgText.split('\n').filter(l => l.trim().startsWith('-'));
        for (const line of ddgLines.slice(0, 5)) {
          const clean = line.replace(/^-\s*/, '').trim();
          const normalized = clean.slice(0, 40).toLowerCase();
          if (!seenTitles.has(normalized)) {
            seenTitles.add(normalized);
            newsItems.push(clean);
          }
        }
      } catch (err) {
        log.warn('news', `Web search news fallback error: ${(err as Error).message}`);
      }
    }

    if (newsItems.length === 0) {
      newsItems.push('No significant news available at this time');
    }

    return newsItems;
  }

  /**
   * A ticker-specific live RSS query is the primary dashboard-news source.
   * It remains useful when a vendor's ticker search is stale or unavailable.
   */
  private async collectTickerRss(symbol: string): Promise<FormattedNews[]> {
    try {
      const items = await newsFetchService.fetchTickerNews(symbol);
      return items.map(item => ({
        title: item.title,
        formatted: item.source ? `${item.title} [${item.source}]` : item.title,
      }));
    } catch (error) {
      log.warn('news', `Ticker RSS news error: ${(error as Error).message}`);
      return [];
    }
  }

  private async collectYahooNews(symbol: string): Promise<FormattedNews[]> {
    try {
      const result = await yahooFinance.search(symbol, { newsCount: 8, quotesCount: 0 });
      const rows: FormattedNews[] = [];
      for (const item of result.news ?? []) {
        if (!item.title) continue;
        rows.push({
          title: item.title,
          formatted: item.publisher ? `${item.title} [${item.publisher}]` : item.title,
        });
      }
      return rows;
    } catch (error) {
      log.warn('news', `Yahoo Finance news error: ${(error as Error).message}`);
      return [];
    }
  }

  /** Category feeds, filtered down to rows that actually mention the symbol. */
  private async collectExtraNews(symbol: string, isIndonesian: boolean): Promise<FormattedNews[]> {
    try {
      const [extraStockNews, extraBroadNews] = await Promise.all([
        isIndonesian ? newsFetchService.fetchIndonesiaNews() : newsFetchService.fetchStockNews(),
        newsFetchService.fetchBroadMarketNews(),
      ]);

      const cleanSymbol = symbol.replace(/\.JK$/i, '').toUpperCase();
      return [...extraStockNews, ...extraBroadNews]
        .filter(item => {
          const titleUpper = item.title.toUpperCase();
          const inTitle = titleUpper.includes(cleanSymbol);
          const inAssets = item.assets?.some(a => a.toUpperCase() === cleanSymbol);
          return inTitle || inAssets;
        })
        .map(item => ({
          title: item.title,
          formatted: item.source ? `${item.title} [${item.source}]` : item.title,
        }));
    } catch (error) {
      log.warn('news', `Extra news enrichment error: ${(error as Error).message}`);
      return [];
    }
  }
}

interface FormattedNews {
  title: string;
  formatted: string;
}
