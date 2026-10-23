import { NextRequest } from 'next/server';
import { newsFetchService } from '@/services/news/news.fetch.service';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { zonedParts } from '@/shared/market-calendar';
import { classifyHeadline } from '@/shared/news-sentiment';

/** One RSS search per favourite, capped — a calendar month stays cheap. */
const MAX_MONTH_TICKERS = 8;
/** The calendar's day tiles read at most this many headlines per day. */
const MAX_ITEMS_PER_DAY = 40;

interface MonthDayItem {
  ticker: string;
  title: string;
  source: string;
  timestamp: string;
  url: string | null;
  /** Determined once here; saved payloads then never lose the tone. */
  sentiment: string;
}

/**
 * Validate a client-supplied IANA timezone by simply asking Intl to use it.
 * Anything invalid (or an injection-looking string) falls back to UTC — a
 * broken timezone must never produce a broken or shifted day bucket.
 */
function validatedTimezone(raw: string | null): string {
  const candidate = (raw ?? '').trim();
  if (!candidate) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

/**
 * GET /api/market/news/month?date=YYYY-MM&tz=<IANA>&tickers=A,B,C
 *
 * The dashboard calendar's day colours mean SENTIMENT (green = the day's
 * watchlist headlines lean bullish, red = bearish), so the calendar needs
 * every day of the month it shows, not one day at a time. It is GLOBAL — the
 * route is deliberately market-agnostic; the caller supplies the timezone the
 * squares are drawn in (the user's own device clock, validated above, UTC
 * fallback), and each headline lands on the day it HAPPENED in that clock via
 * the same zonedParts plumbing that builds the visible squares — news and
 * calendar squares can never disagree on a day boundary.
 *
 * ONE per-favourite 30-day history fetch (server-cached) feeds the whole
 * month. Per-ticker feed failures degrade to no rows for that ticker — one
 * dead search must never blank the month — and unparseable timestamps are
 * dropped rather than guessed onto a wrong day. The widget then SAVES these
 * day lists client-side, so a day's headlines survive even after the ~30-day
 * feed window rolls past it.
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}$/.test(date)) {
    return errorResponse('Missing or invalid ?date (expected YYYY-MM)', 400);
  }
  const timeZone = validatedTimezone(request.nextUrl.searchParams.get('tz'));
  const tickers = [
    ...new Set(
      (request.nextUrl.searchParams.get('tickers') ?? '')
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_MONTH_TICKERS);

  if (tickers.length === 0) {
    return jsonResponse({ month: date, timezone: timeZone, tickers: [], days: {} });
  }

  try {
    const perTicker = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          return { ticker, news: await newsFetchService.fetchTickerNewsHistory(ticker) };
        } catch {
          return { ticker, news: [] };
        }
      }),
    );

    const seen = new Set<string>();
    const days: Record<string, MonthDayItem[]> = {};
    for (const { ticker, news } of perTicker) {
      for (const item of news) {
        if (!item?.title || !item?.timestamp) continue;
        const epoch = Date.parse(item.timestamp);
        if (Number.isNaN(epoch)) continue;
        const dateKey = zonedParts(timeZone, epoch).dateKey;
        if (!dateKey.startsWith(date)) continue; // strictly the requested month
        const dedupeKey = item.url || `${item.title}|${item.source}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        (days[dateKey] ??= []).push({
          ticker,
          title: item.title,
          source: item.source,
          timestamp: item.timestamp,
          url: item.url ?? null,
          sentiment: classifyHeadline(item.title),
        });
      }
    }

    for (const dateKey of Object.keys(days)) {
      days[dateKey]
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, MAX_ITEMS_PER_DAY);
      days[dateKey] = days[dateKey].slice(0, MAX_ITEMS_PER_DAY);
    }

    return jsonResponse({ month: date, timezone: timeZone, tickers, days });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(`News unavailable: ${msg}`);
  }
}
