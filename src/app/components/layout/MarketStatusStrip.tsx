'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMonthGrid,
  formatCountdown,
  globalDayStatus,
  localDateKey,
  monthLabelFromKey,
  sessionSnapshot,
  sessionWindowLabel,
  type CalendarMarket,
  type CalendarServiceResult,
  type DaySquare,
  type SessionSnapshot,
} from '@/shared/market-calendar';
import { classifyHeadline, headlineToneCounts } from '@/shared/news-sentiment';

/**
 * Dashboard global market-intel widget — deliberately market-AGNOSTIC, never
 * pinned to IDX or US, never split into per-market pieces:
 *
 *   <MiniCalendarWidget />  one GLOBAL month calendar (weekday columns × week
 *                           rows, true 1:1 day squares) pinned top-right of
 *                           the dashboard content. "Today" is the user's own
 *                           device day — the calendar does not belong to one
 *                           exchange. Squares carry NO open/closed colour:
 *                           green/red is reserved for NEWS SENTIMENT — a day
 *                           whose saved watchlist headlines net bullish
 *                           paints green, net bearish paints red, anything
 *                           else stays neutral. A day mutes to grayscale only
 *                           when NEITHER IDX nor US trades (weekend, or a
 *                           one-market holiday is named in the tooltip while
 *                           the day keeps its tone). Clicking a day number
 *                           opens that day's saved watchlist news; the
 *                           schedule button opens the global schedule popover
 *                           (sessions + holidays of BOTH exchanges).
 * Global sessions info: a muted two-row footer inside the same card — IDX and
 * US get exactly the same treatment, words carry the state, never a colour.
 *
 * Data feeding:
 *  - /api/market/calendar — fetched holidays (both exchanges), cached in
 *    localStorage so reloads and short outages still render real squares.
 *  - /api/market/news/month — ONE batched fetch per (month, device clock,
 *    favourites) buckets every favourite's 30-day history into per-day lists
 *    server-side (in the device timezone the squares are drawn in, so the
 *    bucket always matches the square the user sees). Each result is SAVED to
 *    localStorage per day: a day's headlines show up on the day they happened
 *    and then stay saved, even after the ~30-day feed window rolls past that
 *    day. No per-click requests, ever.
 *  - Session math never needs a quote request: wall-clock only.
 */

const CALENDAR_CACHE_KEY = 'boz_strip_calendar_cache';
const FAVORITES_KEY = 'boz_favorites';
const FAVORITES_EVENT = 'boz_favorites_changed';
/** Saved day news: key `${dateKey}|${tz}` → one day's headlines. */
const DAY_NEWS_SAVE_KEY = 'boz_day_news_cache';
/** Calendar data is year-granular: a week-old cache still beats weekend-only. */
const CALENDAR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CALENDAR_FETCH_REFETCH_MS = 12 * 60 * 60 * 1000;
/** A cache older than this is painted but flagged until the network answers. */
const CALENDAR_STALE_FLAG_MS = 24 * 60 * 60 * 1000;
/** Session states/countdowns follow the wall clock, not the second hand. */
const CLOCK_TICK_MS = 30_000;
/** Favourites per month fetch (route caps harder server-side). */
const MONTH_NEWS_TICKER_CAP = 8;
/** Matches the route's per-day cap and the service's history cache TTL. */
const MAX_DAY_ITEMS = 40;
const MONTH_NEWS_REFETCH_MS = 15 * 60 * 1000;
/** Bounded saved history: the oldest day entries drop first. */
const DAY_NEWS_SAVE_MAX_ENTRIES = 60;
/** A day paints green/red only from at least this many toned headlines. */
const MIN_TONE_SAMPLES = 2;

interface HolidayRow {
  date: string;
  name: string;
  market: CalendarMarket;
}

/** One saved headline of one calendar day, as saved from the month route. */
interface DayNewsItem {
  ticker: string;
  title: string;
  source: string;
  timestamp: string;
  url: string | null;
  /** Decided at bucket time server-side; normalized on load from storage. */
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

const MARKET_LABEL: Record<CalendarMarket, string> = { idx: 'IDX', us: 'US' };

/** The ONE clock the global calendar runs on: the user's device timezone.
 *  An unreadable option falls back to UTC — never to an invented zone. */
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ─── Shared data hooks ───────────────────────────────────────────────────────

/** Wall clock accessor; all count-down widgets share the same 30s tick. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Holiday feed (both exchanges) with a localStorage cache: first paint is
 *  already real, the network revalidates quietly, broken feeds degrade loudly.
 *  No calendar is ever invented locally — without a payload the UI shows
 *  skeletons and says the feed is unreachable. */
function useMarketCalendar(): {
  calendarData: CalendarServiceResult | null;
  calendarDegraded: boolean;
  fetchFailed: boolean;
} {
  const [calendarData, setCalendarData] = useState<CalendarServiceResult | null>(null);
  const [calendarDegraded, setCalendarDegraded] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    try {
      const raw = window.localStorage.getItem(CALENDAR_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as CalendarServiceResult;
        const age = Date.now() - (cached?.generatedAt ?? 0);
        if (cached?.idx?.holidays && age < CALENDAR_MAX_AGE_MS) {
          setCalendarData(cached);
          setCalendarDegraded(
            cached.idx.source === 'unavailable' ||
              cached.us.source === 'unavailable' ||
              age > CALENDAR_STALE_FLAG_MS,
          );
        }
      }
    } catch {
      // Corrupt cache — the fetch below repaints from live data.
    }

    const load = async () => {
      try {
        const res = await fetch('/api/market/calendar');
        if (!res.ok) return;
        const payload = (await res.json()) as CalendarServiceResult;
        if (cancelled || !payload?.idx) return;
        setCalendarData(payload);
        setFetchFailed(false);
        setCalendarDegraded(payload.idx.source === 'unavailable' || payload.us.source === 'unavailable');
        try {
          window.localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(payload));
        } catch {
          // Storage full — the in-memory copy still serves this mount.
        }
      } catch {
        if (!cancelled) setFetchFailed(true);
        // Offline: cached squares stay, along with the flag painted above.
      }
    };

    void load();
    const timer = setInterval(() => void load(), CALENDAR_FETCH_REFETCH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { calendarData, calendarDegraded, fetchFailed };
}

function readFavorites(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function useFavorites(): string[] {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    setFavorites(readFavorites());
    window.addEventListener(FAVORITES_EVENT, () => setFavorites(readFavorites()));
    return () => window.removeEventListener(FAVORITES_EVENT, () => setFavorites(readFavorites()));
  }, []);
  return favorites;
}

// ─── Saved day news (the calendar's memory) ──────────────────────────────────

/** Validate one headline crossing back from localStorage; malformed rows are
 *  dropped, never cast, and a missing/unknown tone is re-decided locally. */
function normalizeDayItem(value: unknown): DayNewsItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<DayNewsItem>;
  if (typeof item.title !== 'string' || typeof item.timestamp !== 'string') return null;
  if (typeof item.ticker !== 'string' || !item.title.trim() || Number.isNaN(Date.parse(item.timestamp))) {
    return null;
  }
  const sentiment =
    item.sentiment === 'bullish' || item.sentiment === 'bearish'
      ? item.sentiment
      : classifyHeadline(item.title);
  return {
    ticker: item.ticker,
    title: item.title,
    source: typeof item.source === 'string' ? item.source : '',
    timestamp: item.timestamp,
    url: typeof item.url === 'string' ? item.url : null,
    sentiment,
  };
}

/** Deduplicate and cap one day's merged headlines, newest first. */
function mergeDayItems(...groups: Array<Array<DayNewsItem> | undefined>): DayNewsItem[] {
  const seen = new Set<string>();
  const merged: DayNewsItem[] = [];
  for (const group of groups) {
    for (const item of group ?? []) {
      if (!item) continue;
      const key = item.url || `${item.title}|${item.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_DAY_ITEMS);
}

function readDayNewsSave(): { version: 1; entries: Record<string, { updatedAt: number; items: DayNewsItem[] }> } {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DAY_NEWS_SAVE_KEY) ?? '');
    if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object') return parsed;
  } catch {
    // Missing or corrupt save — an empty one is rebuilt below.
  }
  return { version: 1, entries: {} };
}

/** This clock's saved days, keyed by dateKey. */
function savedDaysForTimezone(tz: string): Record<string, DayNewsItem[]> {
  const wanted: Record<string, DayNewsItem[]> = {};
  const suffix = `|${tz}`;
  for (const [key, entry] of Object.entries(readDayNewsSave().entries)) {
    if (!key.endsWith(suffix) || !entry || !Array.isArray(entry.items)) continue;
    const items = entry.items
      .map(normalizeDayItem)
      .filter((item): item is DayNewsItem => item !== null);
    if (items.length > 0) wanted[key.slice(0, key.length - suffix.length)] = items;
  }
  return wanted;
}

/** Merge one month's bucketed fetch into the save. An empty fetched day never
 *  erases saved headlines (the feed ages out of ~30-day history; the save must
 *  not), and the store prunes oldest-entry-first to stay bounded. */
function persistDayNews(tz: string, fresh: Record<string, DayNewsItem[]>): void {
  try {
    const save = readDayNewsSave();
    const updatedAt = Date.now();
    for (const [dateKey, items] of Object.entries(fresh)) {
      if (!Array.isArray(items) || items.length === 0) continue;
      const key = `${dateKey}|${tz}`;
      const previous = Array.isArray(save.entries[key]?.items) ? save.entries[key].items : [];
      save.entries[key] = { updatedAt, items: mergeDayItems(previous, items) };
    }
    for (const [dropKey] of Object.entries(save.entries)
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      .slice(0, Math.max(0, Object.keys(save.entries).length - DAY_NEWS_SAVE_MAX_ENTRIES))) {
      delete save.entries[dropKey];
    }
    window.localStorage.setItem(DAY_NEWS_SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage optional — the in-memory month data still renders this mount.
  }
}

function useMonthNews(
  tz: string,
  monthKey: string | null,
  tickers: string[],
): { itemsByDay: Record<string, DayNewsItem[]>; loading: boolean } {
  const [savedByDay, setSavedByDay] = useState<Record<string, DayNewsItem[]>>({});
  const [freshByDay, setFreshByDay] = useState<Record<string, DayNewsItem[]>>({});
  const [loading, setLoading] = useState(false);
  const tickersKey = tickers.join(',');

  // The saved history for this clock: painted instantly, before any network.
  useEffect(() => {
    setSavedByDay(savedDaysForTimezone(tz));
  }, [tz]);

  useEffect(() => {
    if (!monthKey || tickersKey === '') return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/market/news/month?date=${monthKey}&tz=${encodeURIComponent(tz)}&tickers=${encodeURIComponent(tickersKey)}`,
        );
        if (!res.ok) return;
        const payload = (await res.json()) as { days?: Record<string, DayNewsItem[]> };
        if (cancelled || !payload?.days) return;
        const days: Record<string, DayNewsItem[]> = {};
        for (const [dateKey, items] of Object.entries(payload.days)) {
          if (Array.isArray(items) && items.length > 0) {
            const safe = items.map(normalizeDayItem).filter((item): item is DayNewsItem => item !== null);
            if (safe.length > 0) days[dateKey] = safe;
          }
        }
        setFreshByDay(days);
        persistDayNews(tz, days);
        setSavedByDay((current) => {
          const next = { ...current };
          for (const [dateKey, items] of Object.entries(days)) {
            next[dateKey] = mergeDayItems(next[dateKey], items);
          }
          return next;
        });
      } catch {
        // Offline: saved days still render; the save is the calendar's memory.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    // Quietly revalidate while the app is visible (feeds age ~15 min server-side).
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, MONTH_NEWS_REFETCH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tz, monthKey, tickersKey]);

  const itemsByDay = useMemo(() => {
    const merged: Record<string, DayNewsItem[]> = {};
    for (const dateKey of new Set([...Object.keys(savedByDay), ...Object.keys(freshByDay)])) {
      merged[dateKey] = mergeDayItems(savedByDay[dateKey], freshByDay[dateKey]);
    }
    return merged;
  }, [savedByDay, freshByDay]);

  return { itemsByDay, loading };
}

/** A day's tone: green/red is the SENTIMENT of the day's saved headlines, and
 *  only when the sample is wide enough to be honest — fewer than
 *  MIN_TONE_SAMPLES toned headlines or a split day stays neutral. */
function dayToneClass(items: DayNewsItem[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  const { bullish, bearish } = headlineToneCounts(items);
  if (bullish + bearish < MIN_TONE_SAMPLES) return null;
  if (bullish > bearish) return 'mis-tone-bull';
  if (bearish > bullish) return 'mis-tone-bear';
  return null;
}

// ─── Small shared helpers ────────────────────────────────────────────────────

/** timestamp → "14:35" in the user's own clock (day rows). */
function dayTimeLabel(timestamp: string, timeZone: string): string {
  const epoch = Date.parse(timestamp);
  if (Number.isNaN(epoch)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(epoch);
}

/** dateKey → "Thu, Oct 23" for tooltip and popover rows. An unparsable input
 *  renders the raw key (or a dash) — never a literal "Invalid Date". */
function shortDateLabel(dateKey: string): string {
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateKey || '—';
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "Thu, Oct 22" — the today anchor of the user's own clock, same guard. */
function todayLabelFromKey(dateKey: string): string {
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Per-tile tooltip — global schedule first where it applies, otherwise the
 *  day's saved-news tone. No green/red claims about open/closed — colour on
 *  squares now only follows news sentiment. */
function squareTitle(
  square: DaySquare,
  items: DayNewsItem[] | undefined,
  idxHolidays: Array<{ date: string; name: string }> | undefined,
  usHolidays: Array<{ date: string; name: string }> | undefined,
): string {
  const date = shortDateLabel(square.dateKey);
  const isFuture = !square.isPast && !square.isToday;
  const status = globalDayStatus(square.dateKey, idxHolidays, usHolidays);
  let text: string;
  if (!status.anyTrading) {
    text = `${date} — Closed · ${status.closedLabels[0] ?? 'weekend'}`;
  } else if (!status.usTrading || !status.idxTrading) {
    const openLabel = status.idxTrading ? 'IDX trading' : 'US trading';
    const closedLabel = status.usTrading ? 'IDX closed' : 'US closed';
    const closedName = status.usTrading ? undefined : usHolidays?.find((h) => h.date === square.dateKey)?.name;
    const nameSuffix = closedName ? ` (${closedName})` : '';
    text = `${date} — ${openLabel} · ${closedLabel}${nameSuffix}`;
  } else if (isFuture) {
    text = `${date} — scheduled · headlines show up on the day they happen`;
  } else {
    const count = items?.length ?? 0;
    if (count === 0) {
      text = `${date} — no saved watchlist news`;
    } else {
      const { bullish, bearish } = headlineToneCounts(items!);
      const tone = bullish > bearish ? 'net bullish' : bearish > bullish ? 'net bearish' : 'mixed';
      text = `${date} — ${count} headline${count === 1 ? '' : 's'} · ${tone} (${bullish}▲ ${bearish}▼)`;
    }
  }
  return `${text} · click for the list`;
}

/** session boundary minute → "15:50", for session rows. */
function clockLabel(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ─── Real dropdown positioning ───────────────────────────────────────────────
// The popovers drop straight below their OWN trigger (schedule button or the
// clicked day square), right-aligned to it like a native select, and clamped
// into the viewport — not a floating panel bolted to the card's bottom edge.

/** Mirrors the .mis-popover CSS width. */
const POPOVER_WIDTH = 330;
/** Small gap below the trigger and the viewport edge guard. */
const POPOVER_GAP = 6;
const POPOVER_MARGIN = 8;

function anchorBelow(
  trigger: HTMLElement,
  card: HTMLDivElement | null,
): { top: number; left: number } | null {
  if (!card) return null;
  const cardRect = card.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth || cardRect.width;
  const leftInViewport = Math.max(
    POPOVER_MARGIN,
    Math.min(triggerRect.right - POPOVER_WIDTH, viewportWidth - POPOVER_WIDTH - POPOVER_MARGIN),
  );
  return {
    top: triggerRect.bottom - cardRect.top + POPOVER_GAP,
    left: leftInViewport - cardRect.left,
  };
}

// ─── The global mini-month calendar ──────────────────────────────────────────

export function MiniCalendarWidget() {
  const { calendarData, calendarDegraded, fetchFailed } = useMarketCalendar();
  const favorites = useFavorites();
  const now = useClock();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tz = useMemo(() => deviceTimezone(), []);

  const todayKey = useMemo(() => localDateKey(now), [now]);
  const monthKey = todayKey?.slice(0, 7) ?? null;
  const dayTickers = useMemo(
    () => favorites.slice(0, MONTH_NEWS_TICKER_CAP).map((t) => t.toUpperCase()),
    [favorites],
  );
  const { itemsByDay, loading: newsLoading } = useMonthNews(tz, monthKey, dayTickers);

  const grid = useMemo(() => (todayKey ? buildMonthGrid(todayKey) : null), [todayKey]);
  const idxHolidays = calendarData?.idx?.holidays;
  const usHolidays = calendarData?.us?.holidays;

  const monthLabel = useMemo(
    () => (todayKey ? monthLabelFromKey(todayKey) : ''),
    [todayKey],
  );

  /** Popover rows: BOTH exchanges' holidays in one global list. */
  const holidayRows = useMemo<HolidayRow[]>(() => {
    if (!calendarData) return [];
    const horizonKey = addDays(todayKey ?? '2026-01-01', 60);
    return (['idx', 'us'] as const)
      .flatMap((market) => (calendarData[market]?.holidays ?? []).map((holiday) => ({ ...holiday, market })))
      .filter((holiday) => holiday.date >= (todayKey ?? '') && holiday.date <= horizonKey)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);
  }, [calendarData, todayKey]);

  // Global live sessions, computed in this card: wall-clock only, both
  // exchanges treated identically, always muted rows below the grid.
  const idxSession = useMemo(
    () => sessionSnapshot('idx', now, idxHolidays),
    [idxHolidays, now],
  );
  const usSession = useMemo(
    () => sessionSnapshot('us', now, usHolidays),
    [usHolidays, now],
  );

  // Popover is a real dropdown: anchored under its own trigger. Clicking
  // elsewhere or pressing Escape closes it and releases the anchor.
  useEffect(() => {
    if (!popoverOpen && !openDay) return;
    const closePopovers = () => {
      setPopoverOpen(false);
      setOpenDay(null);
      setAnchor(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) closePopovers();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopovers();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverOpen, openDay]);

  const toggleDay = (dateKey: string, trigger: HTMLElement) => {
    // Day news needs NO network on click: the month fetch is already saved
    // per day, so the list opens instantly from the same data the squares
    // painted — dropping from the clicked square like a native dropdown.
    if (openDay === dateKey) {
      setOpenDay(null);
      setAnchor(null);
      return;
    }
    setPopoverOpen(false);
    setAnchor(anchorBelow(trigger, cardRef.current));
    setOpenDay(dateKey);
  };

  const showSkeleton = !grid;
  const openDayItems = openDay ? (itemsByDay[openDay] ?? []) : [];

  return (
    <div className="mis-card mis-cal" ref={cardRef}>
      <div className="mis-cal-top">
        <span className="mis-cal-month">{monthLabel || <span className="mis-cal-month-skel" />}</span>
        <button
          type="button"
          className="mis-cal-schedule-btn"
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          title="Global schedule — IDX & US sessions and holidays"
          onClick={(event) => {
            setOpenDay(null);
            if (popoverOpen) {
              setPopoverOpen(false);
              setAnchor(null);
            } else {
              setAnchor(anchorBelow(event.currentTarget, cardRef.current));
              setPopoverOpen(true);
            }
          }}
        >
          GLOBAL
          <i className="fa-solid fa-angle-down" aria-hidden="true" />
          {(calendarDegraded || (fetchFailed && !calendarData)) && <span className="mis-calendar-warn" title="Holiday feed unreachable" aria-label="Schedule feed degraded" />}
        </button>
      </div>

      <div className="mis-cal-weekdays" aria-hidden="true">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, index) => (
          <span key={`${letter}-${index}`}>{letter}</span>
        ))}
      </div>

      <div className="mis-cal-days">
        {showSkeleton
          ? Array.from({ length: 35 }, (_, index) => (
              <span key={`skel-${index}`} className="mis-cell mis-cell-skel" aria-hidden="true" />
            ))
          : [
              ...Array.from({ length: grid!.leadingBlanks }, (_, index) => (
                <span key={`blank-${index}`} className="mis-blank" aria-hidden="true" />
              )),
              ...grid!.days.map((square) => {
                const isFuture = !square.isPast && !square.isToday;
                const dayItems = isFuture ? undefined : itemsByDay[square.dateKey];
                const tone = dayToneClass(dayItems);
                const status = globalDayStatus(square.dateKey, idxHolidays, usHolidays);
                return (
                  <button
                    type="button"
                    key={square.dateKey}
                    className={[
                      'mis-cell',
                      status.anyTrading ? '' : 'is-closed',
                      square.isToday ? 'is-today' : square.isPast ? 'is-past' : 'is-future',
                      tone ?? '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={squareTitle(square, dayItems, idxHolidays, usHolidays)}
                    onClick={(event) => toggleDay(square.dateKey, event.currentTarget)}
                  >
                    <span className="mis-cell-day">{square.dayOfMonth}</span>
                  </button>
                );
              }),
            ]}
      </div>

      {fetchFailed && !calendarData && (
        <span className="mis-cal-note">Holiday feed unreachable — closures follow the weekend rule until it returns.</span>
      )}

      {/* Global sessions footer: both exchanges in one muted block, words
          (open/pre/closed) carry the state — never a colour. */}
      <div className="mis-cal-sessions" aria-label="Global market sessions">
        <GlobalSessionRow market="idx" snapshot={idxSession} />
        <GlobalSessionRow market="us" snapshot={usSession} />
      </div>

      {popoverOpen && (
        <div
          className="mis-popover"
          role="dialog"
          aria-label="Global market schedule"
          style={anchor ? { top: anchor.top, left: anchor.left } : undefined}
        >
          <div className="mis-popover-header">
            <span className="mis-popover-heading">Global schedule</span>
            <span className="mis-popover-tag">IDX · US</span>
          </div>
          <div className="mis-popover-note">
            {calendarDegraded
              ? 'Holiday feed unreachable — closures follow the weekend rule until it returns.'
              : 'Both exchanges in one calendar. A day only mutes when neither market trades; one-market closures are named on the day.'}
          </div>
          <div className="mis-popover-holidays">
            {holidayRows.length === 0 ? (
              <span className="mis-popover-empty">
                {calendarDegraded || (fetchFailed && !calendarData)
                  ? 'No holiday data available right now.'
                  : 'No market holidays in the next 60 days.'}
              </span>
            ) : (
              holidayRows.map((holiday) => (
                <div key={`${holiday.market}-${holiday.date}`} className="mis-popover-row">
                  <span className="mis-popover-market">{MARKET_LABEL[holiday.market]}</span>
                  <span className="mis-popover-date">{shortDateLabel(holiday.date)}</span>
                  <span className="mis-popover-name">{holiday.name}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {openDay && (
        <div
          className="mis-popover"
          role="dialog"
          aria-label={`News for ${shortDateLabel(openDay)}`}
          style={anchor ? { top: anchor.top, left: anchor.left } : undefined}
        >
          <div className="mis-popover-header">
            <span className="mis-popover-heading">NEWS · {shortDateLabel(openDay)}</span>
            <button
              type="button"
              className="mis-popover-close"
              aria-label="Close day news"
              onClick={() => {
                setOpenDay(null);
                setAnchor(null);
              }}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
          {dayTickers.length === 0 ? (
            <span className="mis-day-empty">Star tickers to see their news, day by day.</span>
          ) : openDayItems.length === 0 && newsLoading ? (
            <div className="mis-day-list" aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <span key={`day-skel-${index}`} className="mis-day-skel" />
              ))}
            </div>
          ) : openDayItems.length === 0 ? (
            <span className="mis-day-empty">
              No saved watchlist news for this day.{isFeedWindowOpen(openDay, todayKey) ? ' Still landing — try again shortly.' : ''}
            </span>
          ) : (
            <div className="mis-day-list">
              {openDayItems.map((item, index) => (
                <a
                  key={`${item.ticker}-${item.timestamp}-${index}`}
                  className={`mis-day-row tone-${item.sentiment}`}
                  href={item.url || '/news-intel'}
                  target={item.url ? '_blank' : undefined}
                  rel={item.url ? 'noreferrer' : undefined}
                  title={`${item.source} — ${item.title}`}
                >
                  <span className={`mis-day-impact is-${item.sentiment}`} aria-hidden="true" />
                  <span className="mis-day-time">{dayTimeLabel(item.timestamp, tz)}</span>
                  <span className="mis-day-ticker">{item.ticker}</span>
                  <span className="mis-day-title">{item.title}</span>
                  <span className="mis-day-src">{item.source}</span>
                </a>
              ))}
            </div>
          )}
          {openDayItems.length > 0 && (
            <span className="mis-day-note">
              {(() => {
                const { bullish, bearish } = headlineToneCounts(openDayItems);
                const tone = bullish > bearish ? 'net bullish' : bearish > bullish ? 'net bearish' : 'mixed';
                return `Saved from the day it happened · ${tone} · ${bullish}▲ ${bearish}▼ · watchlist: ${dayTickers.join(', ')}`;
              })()}
            </span>
          )}
        </div>
      )}

      {todayKey && <span className="mis-visually-hidden">{todayLabelFromKey(todayKey)}</span>}
    </div>
  );
}

/** Whether the clicked day is inside the fetchable history window (~a month
 *  back) or still the current day: only then can a missing list still land. */
const FEED_WINDOW_DAYS = 30;
function isFeedWindowOpen(dateKey: string | null, todayKey: string | null): boolean {
  if (!dateKey || !todayKey) return false;
  const [y, m, d] = todayKey.split('-').map(Number);
  const horizon = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  horizon.setUTCDate(horizon.getUTCDate() - FEED_WINDOW_DAYS);
  return dateKey >= horizon.toISOString().slice(0, 10) && dateKey <= todayKey;
}

// ─── Global session rows (the only session indicator) ────────────────────────
// No per-market "IDX OPEN" claim cards anymore: one muted row per exchange,
// words carry open/pre/closed, colour stays reserved for news sentiment.

function GlobalSessionRow({ market, snapshot }: { market: CalendarMarket; snapshot: SessionSnapshot }) {
  const state = snapshot.state === 'open' ? 'open' : snapshot.state === 'pre' ? 'pre' : 'closed';
  const boundary = clockLabel(snapshot.boundaryMinutesOfDay);
  const detail = `${state === 'open' ? 'closes' : 'opens'} ${boundary} · ${formatCountdown(snapshot.minutesToBoundary)}`;
  return (
    <div
      className={`mis-global-session${snapshot.state === 'open' ? ' is-open' : ''}`}
      title={
        snapshot.state === 'open'
          ? `${MARKET_LABEL[market]} session is open — ${detail}`
          : `${MARKET_LABEL[market]} session is not open — next ${detail}`
      }
    >
      <span className="mis-global-session-name">{MARKET_LABEL[market]}</span>
      <span className="mis-global-session-window">{sessionWindowLabel(market)}</span>
      <span className="mis-global-session-detail">{detail}</span>
    </div>
  );
}

// ─── News lives BEHIND the calendar ──────────────────────────────────────────
// There is deliberately no always-visible news list section here. The
// dashboard's Latest-Intel strip was a passive always-on element consuming
// vertical space for the same headlines the /news-intel page serves better;
// day news opens from the calendar day squares, with everything already
// saved close to the day it happened (see MiniCalendarWidget).
