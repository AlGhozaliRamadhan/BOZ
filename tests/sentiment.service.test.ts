import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentimentService } from '../src/services/market/sentiment.service.js';

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
    delete (globalThis as { __redditCache?: unknown }).__redditCache;
  });

  afterEach(() => {
    mockState.ticker = 'BTC-USD';
    mockState.get.mockReset();
    vi.unstubAllGlobals();
    delete (globalThis as { __redditCache?: unknown }).__redditCache;
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
});
