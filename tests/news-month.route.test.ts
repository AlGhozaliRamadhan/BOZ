import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/market/news/month/route.js';
import { newsFetchService } from '../src/services/news/news.fetch.service.js';
import { epochAtZonedMinutes } from '../src/shared/market-calendar.js';

vi.mock('../src/services/news/news.fetch.service.js', () => ({
  newsFetchService: {
    fetchTickerNewsHistory: vi.fn(),
  },
}));

afterEach(() => vi.restoreAllMocks());

const NY = 'America/New_York';
const IDX = 'Asia/Jakarta';

// A headline "on" a calendar day is bucketed in the CALLER'S clock (the
// timezone the squares are drawn in), not UTC: the same instant reads
// 2026-10-22 in New York and 2026-10-23 in Jakarta, exactly like the calendar
// square the user sees.
const usDayNoon = epochAtZonedMinutes(NY, '2026-10-22', 12 * 60);

const item = (overrides: Record<string, unknown> = {}) => ({
  title: 'Headline A',
  source: 'Reuters',
  timestamp: new Date(usDayNoon).toISOString(),
  url: 'https://example.com/a',
  impact: 'medium',
  assets: ['NVDA'],
  ...overrides,
});

describe('market news month route', () => {
  it('rejects a missing or malformed month without touching the feeds', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    expect((await GET(new NextRequest('http://localhost/api/market/news/month'))).status).toBe(400);
    expect(
      (await GET(new NextRequest('http://localhost/api/market/news/month?date=10-2026'))).status,
    ).toBe(400);
    expect(
      (await GET(new NextRequest('http://localhost/api/market/news/month?date=2026-10-22'))).status,
    ).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers an empty watchlist instantly with no headline work', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    const response = await GET(new NextRequest('http://localhost/api/market/news/month?date=2026-10&tickers=,,,'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ month: '2026-10', timezone: 'UTC', tickers: [], days: {} });
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to UTC for an invalid or unknown timezone instead of breaking the bucket', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue([]);

    for (const bad of ['Not/AZone', '../../etc/passwd', '   ']) {
      const response = await GET(
        new NextRequest(`http://localhost/api/market/news/month?date=2026-10&tz=${encodeURIComponent(bad)}&tickers=NVDA`),
      );
      const json = await response.json();
      expect(response.status).toBe(200);
      expect(json.timezone).toBe('UTC');
    }
    // Whitespace-padded valid name is still accepted.
    const padded = await GET(
      new NextRequest(`http://localhost/api/market/news/month?date=2026-10&tz=${encodeURIComponent(' America/New_York ')}&tickers=NVDA`),
    );
    expect((await padded.json()).timezone).toBe('America/New_York');
    expect(spy).toHaveBeenCalled();
  });

  it('buckets every headline onto the day it happened, only inside the month', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    spy.mockImplementation((symbol: string) => {
      if (symbol === 'NVDA') {
        return Promise.resolve([
          item({ title: 'Same story', url: 'https://example.com/dup' }),
          item(),
          // Different days of the SAME month: valid buckets.
          item({
            title: 'Next morning',
            url: 'https://example.com/next',
            timestamp: new Date(usDayNoon + 24 * 3600_000).toISOString(),
          }),
          // Outside the current month: must vanish entirely.
          item({ title: 'November', url: 'https://example.com/nov', timestamp: '2026-11-05T00:00:00Z' }),
          item({ title: 'Unparseable', url: 'https://example.com/u', timestamp: '20260922T120000' }),
        ]);
      }
      // Same article cross-ticker (dedupe) + one later item (sorts first).
      return Promise.resolve([
        item({ title: 'Same story', url: 'https://example.com/dup' }),
        item({
          title: 'Late-bound',
          url: 'https://example.com/late',
          timestamp: new Date(usDayNoon + 3600_000).toISOString(),
        }),
      ]);
    });

    const response = await GET(new NextRequest(`http://localhost/api/market/news/month?date=2026-10&tz=${NY}&tickers=NVDA,nvda,AAPL`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.month).toBe('2026-10');
    expect(json.timezone).toBe(NY);
    expect(json.tickers).toEqual(['NVDA', 'AAPL']);
    expect(Object.keys(json.days).sort()).toEqual(['2026-10-22', '2026-10-23']);

    const oct22 = json.days['2026-10-22'];
    expect(oct22.map((x: unknown) => (x as { title: string }).title)).toEqual([
      'Late-bound', // newer, sorts first
      'Same story',
      'Headline A',
    ]);
    // The first-searched ticker keeps the duplicate copy.
    expect((oct22[1] as { ticker: string }).ticker).toBe('NVDA');
    expect(oct22[0]).toEqual({
      ticker: 'AAPL',
      title: 'Late-bound',
      source: 'Reuters',
      url: 'https://example.com/late',
      sentiment: 'neutral',
      timestamp: new Date(usDayNoon + 3600_000).toISOString(),
    });

    expect(json.days['2026-10-23'].map((x: unknown) => (x as { title: string }).title)).toEqual(['Next morning']);
    expect(JSON.stringify(json)).not.toContain('November');
    expect(JSON.stringify(json)).not.toContain('Unparseable');
    expect(spy.mock.calls.every(([arg]: [unknown]) => typeof arg === 'string')).toBe(true);
  });

  it('attaches a real sentiment decision to each headline', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    spy.mockResolvedValue([
      item({ title: 'Shares soar on record earnings', url: 'https://example.com/b' }),
      item({ title: 'Shares plunge as profit falls', url: 'https://example.com/x', timestamp: new Date(usDayNoon + 60_000).toISOString() }),
    ]);

    const response = await GET(new NextRequest(`http://localhost/api/market/news/month?date=2026-10&tz=${NY}&tickers=NVDA`));
    const json = await response.json();
    const toneByTitle = Object.fromEntries(
      json.days['2026-10-22'].map((x: unknown) => [(x as { title: string }).title, (x as { sentiment: string }).sentiment]),
    );

    expect(toneByTitle['Shares soar on record earnings']).toBe('bullish');
    expect(toneByTitle['Shares plunge as profit falls']).toBe('bearish');
  });

  it('buckets in the asked timezone, not UTC', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    // WIB is +7h from UTC: this instant is 2026-10-23 WIB but 2026-10-22 UTC.
    const jakartaEvening = epochAtZonedMinutes(IDX, '2026-10-23', 23 * 60);
    spy.mockResolvedValue([item({ timestamp: new Date(jakartaEvening).toISOString() })]);

    const response = await GET(new NextRequest(`http://localhost/api/market/news/month?date=2026-10&tz=${IDX}&tickers=BBCA.JK`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(json.days)).toEqual(['2026-10-23']);
  });

  it('caps the favourites searched and degrades one dead ticker to empty', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    const nine = Array.from({ length: 9 }, (_, i) => `T${i}`).join(',');
    spy.mockImplementation(async (symbol: string) => {
      if (symbol === 'T3') throw new Error('feed exploded');
      return [];
    });

    const response = await GET(new NextRequest(`http://localhost/api/market/news/month?date=2026-10&tickers=${nine}`));
    const json = await response.json();

    expect(json.tickers).toHaveLength(8); // harder cap lives server-side
    expect(spy.mock.calls.map(([s]: [string]) => s)).toEqual(json.tickers);
    expect(response.status).toBe(200);
    expect(json.days).toEqual({});
  });

  it('never surfaces an internal error as a broken month', async () => {
    const spy = newsFetchService.fetchTickerNewsHistory as ReturnType<typeof vi.fn>;
    spy.mockRejectedValue(new Error('network detonation'));
    const response = await GET(new NextRequest('http://localhost/api/market/news/month?date=2026-10&tickers=NVDA'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.days).toEqual({});
  });
});
