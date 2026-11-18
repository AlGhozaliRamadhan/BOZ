import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `news.service.ts` builds its own `new YahooFinance()` rather than importing
 * the shared instance from `yahoo.service.ts`, so the vendor search has to be
 * mocked at the module boundary. Without this the suite would hit the network.
 */
const mockState = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock('yahoo-finance2', () => {
  class YahooFinanceMock {
    search = mockState.search;
    quote = vi.fn();
    chart = vi.fn();
    constructor(_options?: unknown) {}
  }
  return { default: YahooFinanceMock };
});

vi.mock('../src/utils/logger.js', () => ({
  clr: {
    white: (v: string) => v, cyan: (v: string) => v, dim: (v: string) => v,
    green: (v: string) => v, yellow: (v: string) => v, red: (v: string) => v,
    ghost: (v: string) => v,
  },
  log: {
    data: vi.fn(), ok: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  },
}));

import { NewsService } from '../src/services/news/news.service.js';
import { newsFetchService, type NewsItem } from '../src/services/news/news.fetch.service.js';
import { webSearchService } from '../src/services/search/web.search.service.js';

function newsItem(title: string, source = 'Feed', assets?: string[]): NewsItem {
  return {
    category: 'stocks', type: 'news', title, details: '',
    source, timestamp: '2025-11-18T10:00:00.000Z', impact: 'medium', assets,
  };
}

function vendorNews(...rows: Array<{ title: string; publisher?: string }>) {
  mockState.search.mockResolvedValue({ news: rows });
}

describe('NewsService.getStockNews', () => {
  let service: NewsService;

  beforeEach(() => {
    service = new NewsService();
    mockState.search.mockReset();
    vendorNews();
    vi.spyOn(newsFetchService, 'fetchTickerNews').mockResolvedValue([]);
    vi.spyOn(newsFetchService, 'fetchStockNews').mockResolvedValue([]);
    vi.spyOn(newsFetchService, 'fetchIndonesiaNews').mockResolvedValue([]);
    vi.spyOn(newsFetchService, 'fetchBroadMarketNews').mockResolvedValue([]);
    vi.spyOn(webSearchService, 'search').mockResolvedValue('');
  });

  afterEach(() => vi.restoreAllMocks());

  it('merges direct, vendor and extra rows in that order, deduped by title', async () => {
    vi.mocked(newsFetchService.fetchTickerNews).mockResolvedValue([newsItem('Shared headline', 'Reuters')]);
    vendorNews(
      { title: 'Shared headline', publisher: 'Yahoo Finance' },
      { title: 'Only from Yahoo', publisher: 'Yahoo Finance' },
    );

    const headlines = await service.getStockNews('AAPL');

    // The RSS row wins the duplicate: it arrived first in the merge order.
    expect(headlines).toEqual([
      'Shared headline [Reuters]',
      'Only from Yahoo [Yahoo Finance]',
    ]);
  });

  it('appends symbol-matched extra rows after the vendor rows', async () => {
    vendorNews({ title: 'Vendor row', publisher: 'Yahoo Finance' });
    vi.mocked(newsFetchService.fetchStockNews).mockResolvedValue([
      newsItem('MSFT reports earnings', 'CNBC'),
    ]);
    vi.mocked(newsFetchService.fetchBroadMarketNews).mockResolvedValue([
      newsItem('Something unrelated', 'MarketWatch'),
      newsItem('Analyst note', 'Broker', ['MSFT']),
    ]);

    const headlines = await service.getStockNews('MSFT');

    expect(headlines).toEqual([
      'Vendor row [Yahoo Finance]',
      'MSFT reports earnings [CNBC]',
      'Analyst note [Broker]',
    ]);
  });

  it('routes Indonesian tickers to the IDX feed instead of the global stock feed', async () => {
    vi.mocked(newsFetchService.fetchIndonesiaNews).mockResolvedValue([
      newsItem('BBCA cetak laba rekor', 'CNBC Indonesia', ['IHSG']),
    ]);

    const headlines = await service.getStockNews('BBCA.JK');

    expect(newsFetchService.fetchIndonesiaNews).toHaveBeenCalledTimes(1);
    expect(newsFetchService.fetchStockNews).not.toHaveBeenCalled();
    expect(headlines[0]).toBe('BBCA cetak laba rekor [CNBC Indonesia]');
  });

  it('falls back to web search when fewer than three headlines survive', async () => {
    vendorNews({ title: 'One row', publisher: 'Yahoo Finance' });
    vi.mocked(webSearchService.search).mockResolvedValue(
      ['Some preamble', '- First web hit', '- Second web hit', '- Third web hit'].join('\n'),
    );

    const headlines = await service.getStockNews('AAPL');

    expect(webSearchService.search).toHaveBeenCalledTimes(1);
    expect(headlines).toContain('First web hit');
    expect(headlines).toContain('Third web hit');
    expect(headlines[0]).toBe('One row [Yahoo Finance]');
  });

  it('does not query the web when three or more headlines are already available', async () => {
    vendorNews(
      { title: 'One', publisher: 'Yahoo Finance' },
      { title: 'Two', publisher: 'Yahoo Finance' },
      { title: 'Three', publisher: 'Yahoo Finance' },
    );

    await service.getStockNews('AAPL');

    expect(webSearchService.search).not.toHaveBeenCalled();
  });

  it('returns the placeholder when every source fails', async () => {
    vi.mocked(newsFetchService.fetchTickerNews).mockRejectedValue(new Error('rss down'));
    mockState.search.mockRejectedValue(new Error('yahoo down'));
    vi.mocked(newsFetchService.fetchStockNews).mockRejectedValue(new Error('vendor down'));
    vi.mocked(newsFetchService.fetchBroadMarketNews).mockRejectedValue(new Error('broad down'));
    vi.mocked(webSearchService.search).mockRejectedValue(new Error('web down'));

    await expect(service.getStockNews('AAPL')).resolves.toEqual([
      'No significant news available at this time',
    ]);
  });
});
