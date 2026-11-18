import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentimentService, clearSentimentCaches } from '../src/services/market/sentiment.service.js';

const mockState = vi.hoisted(() => ({
  ticker: 'BTC-USD',
  get: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: mockState.get,
  },
}));

vi.mock('../src/config/config.js', () => ({
  config: {
    get ticker() {
      return mockState.ticker;
    },
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  clr: {
    dim: (value: string) => value,
    ghost: (value: string) => value,
    green: (value: string) => value,
    red: (value: string) => value,
    yellow: (value: string) => value,
  },
  log: {
    crowd: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('SentimentService', () => {
  beforeEach(() => {
    clearSentimentCaches();
  });

  afterEach(() => {
    mockState.ticker = 'BTC-USD';
    mockState.get.mockReset();
    vi.unstubAllGlobals();
    clearSentimentCaches();
  });

  it('normalizes Yahoo crypto symbols for StockTwits and Reddit', async () => {
    mockState.get.mockImplementation(async (url: string) => {
      let host = '';
      try { host = new URL(url).hostname; } catch { /* ignore */ }
      const hostnameIs = (h: string) => host === h;
      const hostnameEndsWith = (h: string) => host === h || host.endsWith(`.${h}`);

      if (hostnameIs('production.dataviz.cnn.io')) throw new Error('cnn unavailable');
      if (hostnameIs('api.alternative.me')) {
        return {
          data: {
            data: [{ value: '50', value_classification: 'Neutral' }],
          },
        };
      }
      if (hostnameEndsWith('api.stocktwits.com')) {
        return {
          data: {
            messages: [
              { entities: { sentiment: { basic: 'Bullish' } } },
              { entities: { sentiment: { basic: 'Bearish' } } },
            ],
          },
        };
      }
      if (host === 'old.reddit.com' || host === 'www.reddit.com' || host === 'reddit.com') {
        return { data: { data: { children: [] } } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    // This test only verifies the generated Reddit URL. A non-retryable response
    // avoids involving RSS parser timing in an unrelated normalization contract.
    const fetchMock = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await new SentimentService().fetchCrowdSentiment();

    const urls = mockState.get.mock.calls.map(([url]) => String(url));
    const fetchUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some(url => url.includes('/streams/symbol/BTC.X.json'))).toBe(true);
    expect(urls.some(url => url.includes('BTC-USD'))).toBe(false);
    expect(fetchUrls.some(url => url.includes('q=BTC%20OR%20Bitcoin%20OR%20%24BTC'))).toBe(true);
    expect(fetchUrls.some(url => {
      try {
        return new URL(url).hostname === 'old.reddit.com';
      } catch {
        return false;
      }
    })).toBe(false);
  }, 30000);

  it('reuses the market-wide fear & greed read across calls', async () => {
    mockState.get.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      if (host === 'production.dataviz.cnn.io') {
        return { data: { fear_and_greed: { score: 61.2, rating: 'Greed' } } };
      }
      if (host === 'api.stocktwits.com') {
        return { data: { messages: [], symbols: [] } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    const service = new SentimentService();
    const first = await service.fetchCrowdSentiment();
    const second = await service.fetchCrowdSentiment();

    const cnnCalls = mockState.get.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('production.dataviz.cnn.io'));
    expect(cnnCalls).toHaveLength(1);
    expect(second.fear_greed).toEqual(first.fear_greed);
  }, 30000);

  it('returns the same shape when a provider fails', async () => {
    mockState.get.mockImplementation(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    const crowd = await new SentimentService().fetchCrowdSentiment();

    expect(crowd.fear_greed).toBeNull();
    expect(crowd.stocktwits_data).toBeNull();
    expect(crowd.social_buzz).toEqual([]);
    expect(crowd.summary.overall_signals).toEqual(['NEUTRAL']);
  }, 30000);
});
