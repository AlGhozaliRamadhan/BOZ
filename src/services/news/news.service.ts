import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { log } from '../../utils/logger.js';
import { newsFetchService } from './news.fetch.service.js';

export class NewsService {
  async getStockNews(symbol: string): Promise<string[]> {
    const newsItems: string[] = [];
    try {
      const result = await yahooFinance.search(symbol, { newsCount: 5 });
      if (result.news) {
        for (const item of result.news) {
          if (item.title) newsItems.push(item.title);
        }
      }
    } catch (error) {
      log.warn('news', `Yahoo Finance news error: ${(error as Error).message}`);
    }

    try {
      const extraStockNews = await newsFetchService.fetchStockNews();
      const extraBroadNews = await newsFetchService.fetchBroadMarketNews();
      const allExtraItems = [...extraStockNews, ...extraBroadNews];

      const upperSymbol = symbol.toUpperCase();
      const filteredExtra = allExtraItems.filter(item => {
        const inTitle = item.title.toUpperCase().includes(upperSymbol);
        const inAssets = item.assets && item.assets.map(a => a.toUpperCase()).includes(upperSymbol);
        return inTitle || inAssets;
      });

      const seenTitles = new Set<string>();
      for (const title of newsItems) {
        seenTitles.add(title.trim().toLowerCase());
      }

      for (const item of filteredExtra) {
        const normalizedTitle = item.title.trim().toLowerCase();
        if (!seenTitles.has(normalizedTitle)) {
          seenTitles.add(normalizedTitle);
          newsItems.push(item.title);
        }
      }
    } catch (error) {
      log.warn('news', `Extra news enrichment error: ${(error as Error).message}`);
    }

    if (newsItems.length === 0) {
      newsItems.push('No significant news available at this time');
    }

    return newsItems;
  }
}
