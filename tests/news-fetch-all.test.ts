import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { NewsFetchService, type NewsItem } from '../src/services/news/news.fetch.service.js';

function item(category: string, title: string, impact: NewsItem['impact'] = 'low'): NewsItem {
  return {
    category,
    type: 'news',
    title,
    details: '',
    source: 'Test',
    timestamp: '2025-11-18T10:00:00.000Z',
    impact,
  };
}

/**
 * Every category fetch is stubbed with a fixed array. The arrays are returned
 * by reference on every call, which is exactly the shape that used to make
 * `fetchAll` append broad-market rows into the shared cached array.
 */
function stubCategories(service: NewsFetchService) {
  vi.spyOn(service, 'fetchCryptoNews').mockResolvedValue([item('cryptocurrency', 'crypto own')]);
  vi.spyOn(service, 'fetchStockNews').mockResolvedValue([item('stocks', 'stocks own')]);
  vi.spyOn(service, 'fetchMacroNews').mockResolvedValue([item('economy', 'macro own')]);
  vi.spyOn(service, 'fetchIndonesiaNews').mockResolvedValue([item('indonesia', 'id own')]);
  vi.spyOn(service, 'fetchCrowdSentiment').mockResolvedValue({} as any);
  vi.spyOn(service, 'fetchBroadMarketNews').mockResolvedValue([
    item('stocks', 'broad stock', 'high'),
    item('oil', 'broad oil'),
    item('forex', 'broad forex'),
    item('macro', 'broad macro'),
    item('commodities', 'broad commodity'),
    item('economy', 'broad economy', 'medium'),
  ]);
}

describe('NewsFetchService.fetchAll', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not let broad-market rows accumulate across calls', async () => {
    const service = new NewsFetchService();
    stubCategories(service);

    const first = await service.fetchAll(false);
    const second = await service.fetchAll(false);

    expect(first.stocks).toHaveLength(2);
    expect(second.stocks).toHaveLength(2);
    expect(first.indonesia).toHaveLength(1);
    expect(second.indonesia).toHaveLength(1);
    expect(first.all).toHaveLength(second.all.length);
  });

  it('buckets broad rows by category and folds macro into economy', async () => {
    const service = new NewsFetchService();
    stubCategories(service);

    const data = await service.fetchAll(false);

    expect(data.stocks.map(i => i.title)).toEqual(['stocks own', 'broad stock']);
    expect(data.oil.map(i => i.title)).toEqual(['broad oil']);
    expect(data.forex.map(i => i.title)).toEqual(['broad forex']);
    expect(data.commodities.map(i => i.title)).toEqual(['broad commodity']);
    expect(data.economy.map(i => i.title)).toEqual(['macro own', 'broad macro', 'broad economy']);
  });

  it('sorts the combined feed by impact, high first', async () => {
    const service = new NewsFetchService();
    stubCategories(service);

    const data = await service.fetchAll(false);
    const ranks = data.all.map(i => i.impact);

    expect(ranks.filter(r => r === 'high')).toHaveLength(1);
    expect(ranks.indexOf('high')).toBe(0);
    expect(ranks.lastIndexOf('medium')).toBeLessThan(ranks.indexOf('low'));
  });

  it('skips the crowd read when it is not requested', async () => {
    const service = new NewsFetchService();
    stubCategories(service);

    const without = await service.fetchAll(false);
    const withCrowd = await service.fetchAll(true);

    expect(without.crowd_sentiment).toBeUndefined();
    expect(withCrowd.crowd_sentiment).toBeDefined();
    expect(service.fetchCrowdSentiment).toHaveBeenCalledTimes(1);
  });
});
