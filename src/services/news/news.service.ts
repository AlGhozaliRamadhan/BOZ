import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { log } from '../../utils/logger.js';
import { newsFetchService } from './news.fetch.service.js';
import { webSearchService } from '../search/web.search.service.js';

export class NewsService {
  async getStockNews(symbol: string): Promise<string[]> {
    const newsItems: string[] = [];
    const seenTitles = new Set<string>();

    try {
      const result = await yahooFinance.search(symbol, { newsCount: 8, quotesCount: 0 });
      if (result.news) {
        for (const item of result.news) {
          if (item.title) {
            const pub = item.publisher ? ` [${item.publisher}]` : '';
            const normalized = item.title.trim().toLowerCase();
            if (!seenTitles.has(normalized)) {
              seenTitles.add(normalized);
              newsItems.push(`${item.title}${pub}`);
            }
          }
        }
      }
    } catch (error) {
      log.warn('news', `Yahoo Finance news error: ${(error as Error).message}`);
    }

    try {
      const isIndonesian = symbol.toUpperCase().endsWith('.JK') || /^(BBCA|BBRI|BMRI|BBNI|TLKM|ASII|GOTO|ANTM|INCO|ADRO|UNTR|ICBP|INDF|KLBF|PGAS|PTBA|MDKA|AMMN)/i.test(symbol);
      const extraStockNews = isIndonesian
        ? await newsFetchService.fetchIndonesiaNews()
        : await newsFetchService.fetchStockNews();
      const extraBroadNews = await newsFetchService.fetchBroadMarketNews();
      const allExtraItems = [...extraStockNews, ...extraBroadNews];

      const cleanSymbol = symbol.replace(/\.JK$/i, '').toUpperCase();
      const filteredExtra = allExtraItems.filter(item => {
        const titleUpper = item.title.toUpperCase();
        const inTitle = titleUpper.includes(cleanSymbol);
        const inAssets = item.assets && item.assets.map(a => a.toUpperCase()).includes(cleanSymbol);
        return inTitle || inAssets;
      });

      for (const item of filteredExtra) {
        const normalizedTitle = item.title.trim().toLowerCase();
        if (!seenTitles.has(normalizedTitle)) {
          seenTitles.add(normalizedTitle);
          const src = item.source ? ` [${item.source}]` : '';
          newsItems.push(`${item.title}${src}`);
        }
      }
    } catch (error) {
      log.warn('news', `Extra news enrichment error: ${(error as Error).message}`);
    }

    // Fallback: If still under 3 news items, query DuckDuckGo for live headlines
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
}
