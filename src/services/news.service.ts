import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { log, clr } from '../utils/logger.js';

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

    if (newsItems.length === 0) {
      newsItems.push('No significant news available at this time');
    }

    return newsItems;
  }
}
