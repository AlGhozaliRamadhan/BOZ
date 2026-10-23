// ─── services/market/calendar.service.ts ─────────────────────────────────────
// Exchange-holiday intelligence for the market-intel strip.
//
// The squares' red days must be FETCHED, not guessed from weekdays: Indonesian
// cuti bersama and US federal holidays land on weekdays the weekend rule can
// never see. The source is Nager.Date — a free, keyless public-holiday feed —
// chosen for exactly the properties a local app needs: no account, no API
// key, stable JSON. It is national-holiday complete for ID and US; the one
// NYSE-only closure it misses (Good Friday) is added computationally in the
// shared module. Imperfection is surfaced, never hidden: a failed feed marks
// the strip's schedule as weekend-rule fallback instead of inventing days.
//
// Caching is in-process with a long TTL — the calendar is year-granular data.
// A stale entry is served when the live fetch fails, so the strip keeps last
// known holidays through a provider outage.

import { goodFridayKeys } from '@/shared/market-calendar';
import type { CalendarMarket, CalendarServiceResult, HolidayCalendar, HolidayEntry } from '@/shared/market-calendar';

const NAGER_BASE = 'https://date.nager.at/api/v3/PublicHolidays';
const FETCH_TIMEOUT_MS = 8_000;
/** Year-granular data; refresh twice a day at most. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const MARKET_COUNTRY: Record<CalendarMarket, string> = {
  idx: 'ID',
  us: 'US',
};

interface CachedCalendar {
  fetchedAt: number;
  holidays: HolidayEntry[];
  freshness: 'ok' | 'unavailable';
}

interface RawNagerHoliday {
  date?: unknown;
  localName?: unknown;
  name?: unknown;
}

const cache = new Map<CalendarMarket, CachedCalendar>();

/**
 * Parse one Nager rows payload into validated holiday entries. The feed sends
 * both an English and a local name; the English one travels (the strip's
 * tooltips read English), localName fills in where English is blank. Dedupe
 * is on date: one closure per calendar day, first one kept.
 */
export function parseNagerHolidays(raw: unknown): Partial<Record<CalendarMarket, HolidayEntry[]>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Partial<Record<CalendarMarket, HolidayEntry[]>> = {};
  for (const market of ['idx', 'us'] as const) {
    const rows = (raw as Record<CalendarMarket, unknown>)[market];
    if (!Array.isArray(rows)) continue;
    const seen = new Set<string>();
    const holidays: HolidayEntry[] = [];
    for (const row of rows as RawNagerHoliday[]) {
      const date = typeof row?.date === 'string' ? row.date : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) continue;
      const name =
        typeof row?.name === 'string' && row.name.trim()
          ? row.name.trim()
          : typeof row?.localName === 'string'
            ? row.localName.trim()
            : '';
      if (!name) continue;
      seen.add(date);
      holidays.push({ date, name });
    }
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    result[market] = holidays;
  }
  return result;
}

async function fetchMarketHolidays(country: string, years: number[]): Promise<HolidayEntry[]> {
  const responses = await Promise.allSettled(
    years.map(async (year) => {
      const res = await fetch(`${NAGER_BASE}/${year}/${country}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`holiday feed returned ${res.status} for ${country}/${year}`);
      }
      return (await res.json()) as unknown;
    }),
  );
  // One good year is enough to mark the strip alive; a partial result keeps
  // the mid-December span honest only for the year that failed, and the next
  // refresh heals it. All years failing is an outage, not an empty calendar:
  // it must throw so the caller marks the feed 'unavailable' instead of
  // rendering a confident-looking zero-holiday year.
  const fulfilled = responses.filter(
    (settled): settled is PromiseFulfilledResult<unknown> => settled.status === 'fulfilled',
  );
  if (fulfilled.length === 0) {
    throw new Error(`holiday feed unreachable for ${country}`);
  }
  const merged = new Map<string, HolidayEntry>();
  for (const settled of fulfilled) {
    const parsed = parseNagerHolidays(
      country === 'ID' ? { idx: settled.value } : { us: settled.value },
    );
    for (const entry of parsed[country === 'ID' ? 'idx' : 'us'] ?? []) {
      if (!merged.has(entry.date)) merged.set(entry.date, entry);
    }
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Holidays for BOTH markets in one payload: the strip needs them together and
 * one refresh cadence keeps the two squares' semantics in sync. Next year is
 * fetched alongside so the seven forward squares never gray out after New
 * Year's Eve. Good Friday (NYSE-only, feed-missing) is appended here.
 */
export async function getMarketCalendar(now: number = Date.now()): Promise<CalendarServiceResult> {
  const currentYear = new Date(now).getUTCFullYear();
  const years = [currentYear, currentYear + 1];

  const build = async (market: CalendarMarket): Promise<CachedCalendar> => {
    const cached = cache.get(market);
    // A fresh 'ok' list answers; an 'unavailable' marker is re-fetched, so a
    // provider outage only costs one attempt per TTL window.
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS && cached.freshness === 'ok') {
      return cached;
    }
    try {
      const holidays = await fetchMarketHolidays(MARKET_COUNTRY[market], years);
      const fresh: CachedCalendar = {
        fetchedAt: now,
        holidays: market === 'us' ? [...holidays, ...extraUsRules(years)] : holidays,
        freshness: 'ok',
      };
      cache.set(market, fresh);
      return fresh;
    } catch {
      // Serve the stale list when there is one; the UI flags it as fallback.
      return cached ?? {
        fetchedAt: now,
        holidays: market === 'us' ? extraUsRules(years) : [],
        freshness: 'unavailable',
      };
    }
  };

  const [idxCache, usCache] = await Promise.all([build('idx'), build('us')]);

  const toCalendar = (market: CalendarMarket, cacheHit: CachedCalendar): HolidayCalendar => ({
    market,
    fetchedAt: cacheHit.fetchedAt,
    source: cacheHit.freshness,
    holidays: cacheHit.holidays,
  });

  return {
    generatedAt: now,
    idx: toCalendar('idx', idxCache),
    us: toCalendar('us', usCache),
  };
}

/** NYSE-only closures the national feed will not carry. */
function extraUsRules(years: number[]): HolidayEntry[] {
  return goodFridayKeys(years);
}

/** Test hook: clear the in-process cache between cases. */
export function resetCalendarCacheForTests(): void {
  cache.clear();
}
