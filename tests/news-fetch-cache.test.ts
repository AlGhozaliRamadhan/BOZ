import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mockState = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('axios', () => ({
  default: { get: mockState.get },
}));

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

import { NewsFetchService } from '../src/services/news/news.fetch.service.js';

function rssFeed(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${title}</title>
  <item>
    <title>AAPL hits record high - Reuters</title>
    <link>https://example.com/aapl-record</link>
    <description>Ticker rallied on earnings.</description>
    <pubDate>Tue, 18 Nov 2025 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Analysts raise targets - MarketWatch</title>
    <link>https://example.com/aapl-targets</link>
    <description>Analysts lifted price targets.</description>
    <pubDate>Tue, 18 Nov 2025 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;
}

/**
 * Persistence is debounced by 1.5 s, so the sandbox directory and the env
 * override stay in place for the whole file: a late flush must land in the
 * sandbox, never in the app's real cache directory. Each test uses its own
 * symbols, so a leftover disk entry cannot leak into another test's fetch.
 */
describe('NewsFetchService cache', () => {
  let cacheDir: string;
  let previousCacheDir: string | undefined;

  beforeAll(() => {
    previousCacheDir = process.env.BOZ_CACHE_DIR;
    cacheDir = mkdtempSync(join(tmpdir(), 'boz-news-cache-test-'));
    process.env.BOZ_CACHE_DIR = cacheDir;
  });

  beforeEach(() => {
    mockState.get.mockReset();
    mockState.get.mockImplementation(async () => ({ data: rssFeed('Google News') }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Let any pending debounced write finish inside the sandbox before it moves.
    await new Promise(resolve => setTimeout(resolve, 1_800));
    if (previousCacheDir === undefined) delete process.env.BOZ_CACHE_DIR;
    else process.env.BOZ_CACHE_DIR = previousCacheDir;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('coalesces concurrent ticker fetches into a single request', async () => {
    const service = new NewsFetchService();

    const [first, second] = await Promise.all([
      service.fetchTickerNews('AAA'),
      service.fetchTickerNews('AAA'),
    ]);

    expect(mockState.get).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('serves a repeat call from the in-memory cache', async () => {
    const service = new NewsFetchService();

    const first = await service.fetchTickerNews('BBB');
    const second = await service.fetchTickerNews('BBB');

    expect(mockState.get).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('keeps separate cache entries per symbol', async () => {
    const service = new NewsFetchService();

    await service.fetchTickerNews('CCC');
    await service.fetchTickerNews('DDD');

    expect(mockState.get).toHaveBeenCalledTimes(2);
    const urls = mockState.get.mock.calls.map(([url]) => String(url));
    expect(urls.some(url => url.includes('CCC'))).toBe(true);
    expect(urls.some(url => url.includes('DDD'))).toBe(true);
  });

  it('does not cache a failed fetch, so the next call retries', async () => {
    const service = new NewsFetchService();
    mockState.get.mockRejectedValueOnce(new Error('boom'));

    await expect(service.fetchTickerNews('EEE')).rejects.toThrow('boom');

    const recovered = await service.fetchTickerNews('EEE');
    expect(recovered.length).toBeGreaterThan(0);
    expect(mockState.get).toHaveBeenCalledTimes(2);
  });

  it('keeps the history query under its own cache key and TTL', async () => {
    const service = new NewsFetchService();

    await service.fetchTickerNews('FFF');
    await service.fetchTickerNewsHistory('FFF', 30);

    // Both are Google News searches for FFF; they must not share a slot.
    expect(mockState.get).toHaveBeenCalledTimes(2);
    const urls = mockState.get.mock.calls.map(([url]) => String(url));
    expect(urls.some(url => url.includes('when%3A30d'))).toBe(true);

    await service.fetchTickerNewsHistory('FFF', 30);
    expect(mockState.get).toHaveBeenCalledTimes(2);
  });
});
