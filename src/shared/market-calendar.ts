// ─── shared/market-calendar.ts ────────────────────────────────────────────────
// Pure trading-calendar intelligence for the dashboard's GLOBAL market
// calendar. It is deliberately market-agnostic — never pinned to IDX or US:
// one calendar for both exchanges, anchored on the user's own machine clock.
// Everything here is deterministic math over dates, minutes, and holiday
// lists — no network, no DOM, no side effects — so the calendar renders
// squares offline from a cached holiday fetch and this module is directly
// assertable in tests.
//
// Semantics are fixed and documented because a strip that re-means itself is
// worse than no strip. Squares carry NO open/closed COLOUR — green/red on the
// dashboard is reserved for news sentiment (see shared/news-sentiment).
// Schedule shows up only as grayscale muting and tooltip text, decided by
// globalDayStatus: a day mutes when NEITHER exchange trades; a one-market
// closure is named in the tooltip while the day keeps its tone.
// There is deliberately NO performance meaning: coloring squares by daily
// move would duplicate the chart below and need adjudicated daily closes for
// every market.

/** The two exchange calendars a day-square row can honestly encode. */
export type CalendarMarket = 'idx' | 'us';

/** Holiday feed entry. `date` is a calendar-day key `YYYY-MM-DD`. */
export interface HolidayEntry {
  date: string;
  name: string;
}

/** What one holiday-fetch payload carries per market. */
export interface HolidayCalendar {
  market: CalendarMarket;
  /** Absolute epoch ms of the fetch, so the UI can mark staleness. */
  fetchedAt: number;
  /** 'ok' on a live fetch, 'unavailable' when the feed failed — the strip then
   *  renders weekend-closure-only and says so. */
  source: 'ok' | 'unavailable';
  holidays: HolidayEntry[];
}

export interface CalendarServiceResult {
  generatedAt: number;
  idx: HolidayCalendar;
  us: HolidayCalendar;
}

/** Square-schedule semantic, one of exactly two states. Colour no longer
 *  follows this — it only de-emphasises closed days (grayscale) and feeds
 *  tooltips. */
export type SquareStatus = 'trading' | 'closed';

export interface DaySquare {
  /** `YYYY-MM-DD` calendar-day key (timezone-agnostic). */
  dateKey: string;
  dayOfMonth: number;
  status: SquareStatus;
  /** Official closure name on a trading-day-turned holiday (per market). */
  holidayName?: string;
  isToday: boolean;
  isPast: boolean;
}

export interface MonthGrid {
  /** Empty Monday-first leading cells so day 1 lands on its weekday column. */
  leadingBlanks: number;
  /** Every day of the displayed month, oldest → newest. */
  days: DaySquare[];
}

/** Regular session windows in the market's OWN wall clock (minutes of day).
 *  IDX: Jakarta continuous front-to-back window 09:00–15:50 WIB.
 *  US : NYSE/Nasdaq 09:30–16:00 ET. */
const SESSION_WINDOWS: Record<CalendarMarket, { open: number; close: number }> = {
  idx: { open: 9 * 60, close: 15 * 60 + 50 },
  us: { open: 9 * 60 + 30, close: 16 * 60 },
};

export const MARKET_TIME_ZONES: Record<CalendarMarket, string> = {
  idx: 'Asia/Jakarta',
  us: 'America/New_York',
};

const MINUTES_PER_DAY = 24 * 60;

// ─── Timezone-safe wall-clock plumbing ────────────────────────────────────────
// The house pattern (yahoo.service.ts / data-freshness.ts): Intl.DateTimeFormat
// with `formatToParts` to read wall-clock units in one zone without pulling a
// date library into the repo.

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = zonedFormatter(timeZone);
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

interface ZonedParts {
  dateKey: string;
  minutes: number;
}

/** Wall-clock date key + minutes-of-day for one epoch moment in one zone. */
export function zonedParts(timeZone: string, epochMs: number): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minutes: isFinite(hour) && isFinite(minute) ? hour * 60 + minute : 0,
  };
}

/** Calendar day key `YYYY-MM-DD` offset from `key` by `delta` whole days.
 *  Pure string/UTC arithmetic: calendar days do not depend on any timezone. */
export function offsetDateKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + delta);
  return shifted.toISOString().slice(0, 10);
}

/** 0=Monday … 6=Sunday for a `YYYY-MM-DD` key. */
export function weekdayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const wd = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return wd === 0 ? 6 : wd - 1;
}

/** minutes→"1h 23m" / "45m" / "2d 17h" / "0m". never negative. */
export function formatCountdown(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole >= 24 * 60) {
    const d = Math.floor(whole / (24 * 60));
    const h = Math.floor((whole % (24 * 60)) / 60);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (whole >= 60) {
    const h = Math.floor(whole / 60);
    const m = whole % 60;
    return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
  }
  return `${whole}m`;
}

/** Wall-clock epoch for `dateKey` + minutes-of-day in `timeZone`.
 *  Two coarse corrections converge for every real UTC offset (< 24h). */
export function epochAtZonedMinutes(timeZone: string, dateKey: string, minutes: number): number {
  const [y, mo, d] = dateKey.split('-').map(Number);
  let guess = Date.UTC(y, (mo ?? 1) - 1, d ?? 1) + minutes * 60_000;
  for (let i = 0; i < 2; i++) {
    const parts = zonedParts(timeZone, guess);
    const [py, pmo, pd] = parts.dateKey.split('-').map(Number);
    const dayDelta =
      Math.round(
        (Date.UTC(y, (mo ?? 1) - 1, d ?? 1) - Date.UTC(py, (pmo ?? 1) - 1, pd ?? 1)) / 86_400_000,
      );
    guess += dayDelta * 86_400_000 + (minutes - parts.minutes) * 60_000;
  }
  return guess;
}

/** Days between two `YYYY-MM-DD` keys (b - a), purely calendar arithmetic. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(by, (bm ?? 1) - 1, bd ?? 1) - Date.UTC(ay, (am ?? 1) - 1, ad ?? 1)) / 86_400_000,
  );
}

// ─── Holiday helpers ─────────────────────────────────────────────────────────

/** Validated holiday Map (dateKey → name) from a feed payload.
 *  Malformed rows are dropped, never cast: the feed crosses the network. */
export function holidaysAsMap(entries: HolidayEntry[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.date !== 'string' || typeof entry.name !== 'string') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
    if (!entry.name.trim()) continue;
    map.set(entry.date, entry.name.trim());
  }
  return map;
}

/**
 * USA Bonus rule: Good Friday is a full NYSE closure and NOT a US public
 * holiday in most feeds (it is religious, not federal). Computed with the
 * Anonymous Gregorian Computus for the years the window can reach.
 */
export function goodFridayKeys(years: number[]): HolidayEntry[] {
  const keys: HolidayEntry[] = [];
  for (const year of years) {
    if (!Number.isInteger(year) || year < 1900) continue;
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    // Easter Sunday → Good Friday is Easter minus two days.
    const goodFriday = new Date(Date.UTC(year, month - 1, day));
    goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
    keys.push({
      date: goodFriday.toISOString().slice(0, 10),
      name: 'Good Friday (NYSE closed)',
    });
  }
  return keys;
}

// ─── Global calendar view (no market pinning) ────────────────────────────────

/** The date key in the USER'S OWN machine wall clock — the "global" calendar
 *  anchors its today on the user's device, never on one exchange's day. */
export function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Session window label for one market, e.g. "09:00–15:50 WIB" / "09:30–16:00 ET". */
export function sessionWindowLabel(market: CalendarMarket): string {
  const { open, close } = SESSION_WINDOWS[market];
  const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const zone = market === 'idx' ? 'WIB' : 'ET';
  return `${hhmm(open)}–${hhmm(close)} ${zone}`;
}

/** "October 2026" for the calendar header, decided ONLY from the key's own
 *  YYYY-MM. Building the header from the full date key plus `-01` (the old
 *  bug that rendered literally "Invalid Date") is impossible here, and an
 *  unparsable key renders as the empty string — never a broken label. */
export function monthLabelFromKey(dateKey: string): string {
  const month = dateKey.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const parsed = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface GlobalDayStatus {
  /** Each exchange's session schedule for this calendar day. */
  idxTrading: boolean;
  usTrading: boolean;
  /** True when at least one exchange trades that day (square stays unmuted). */
  anyTrading: boolean;
  /** Why a day is fully closed: fetched holiday names, or 'weekend'. */
  closedLabels: string[];
}

/**
 * Combined global schedule status for one calendar day: each market's
 * weekend/holiday closure This is what the dashboard squares mute on — a day
 * is grayed only when NEITHER exchange trades; when just one is off (e.g.
 * Thanksgiving: IDX trades, NYSE closed) the day keeps its sentiment tone and
 * the tooltip names the closure.
 */
export function globalDayStatus(
  dateKey: string,
  idxHolidays: HolidayEntry[] | undefined,
  usHolidays: HolidayEntry[] | undefined,
): GlobalDayStatus {
  const weekend = weekdayIndex(dateKey) >= 5;
  const idxHoliday = holidaysAsMap(idxHolidays).get(dateKey);
  const usHoliday = holidaysAsMap(usHolidays).get(dateKey);
  const idxTrading = !weekend && idxHoliday === undefined;
  const usTrading = !weekend && usHoliday === undefined;

  const labels = new Set<string>();
  if (weekend) labels.add('weekend');
  if (idxHoliday) labels.add(idxHoliday);
  if (usHoliday) labels.add(usHoliday);
  return { idxTrading, usTrading, anyTrading: idxTrading || usTrading, closedLabels: [...labels] };
}

// ─── Month grid (a normal calendar) ──────────────────────────────────────────

/** The displayed month around `todayKey` — a NORMAL calendar: Monday-first
 *  leading blanks, then every day of the month as a cell. Day 1 lands in its
 *  own weekday column; weekends and fetched holidays are flagged
 *  'closed' (rendered as a muted grayscale square, never red); past days sit
 *  dimmer; today is emphasised. Sentiment colouring happens in the widget
 *  from its saved per-day news, not here. */
export function buildMonthGrid(todayKey: string, weeksHolidays?: HolidayEntry[] | undefined): MonthGrid {
  const holidays = holidaysAsMap(weeksHolidays);
  const month = todayKey.slice(0, 7); // 'YYYY-MM'
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  // Day 0 of the following month = the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const leadingBlanks = weekdayIndex(`${month}-01`);
  const days: DaySquare[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${month}-${String(day).padStart(2, '0')}`;
    const holidayName = holidays.get(dateKey);
    days.push({
      dateKey,
      dayOfMonth: day,
      status: weekdayIndex(dateKey) < 5 && holidayName === undefined ? 'trading' : 'closed',
      holidayName,
      isToday: dateKey === todayKey,
      isPast: dateKey < todayKey,
    });
  }
  return { leadingBlanks, days };
}

// ─── Session state (the chips) ───────────────────────────────────────────────

export type SessionState = 'closed' | 'pre' | 'open';

export interface SessionSnapshot {
  state: SessionState;
  /** True when today (market-local) has a scheduled session. */
  sessionToday: boolean;
  /** Minutes of session today, 0 when there is none. */
  windowMinutes: number;
  /** Epoch of the currently (or next) relevant boundary. */
  boundaryEpoch: number;
  /** Positive minutes from `now` to `boundaryEpoch`. */
  minutesToBoundary: number;
  boundaryMinutesOfDay: number;
}

function isTradingDateKey(todayKey: string, holidays: Map<string, string>): boolean {
  const wd = weekdayIndex(todayKey);
  return wd < 5 && !holidays.has(todayKey);
}

/** Live session state for one market at `now`.
 *  this is wall-clock math in the market's own timezone; DST is carried by
 *  Intl, so NYSE keeps its 09:30–16:00 wall window across DST flips. */
export function sessionSnapshot(
  home: CalendarMarket,
  now: number,
  weeksHolidays: HolidayEntry[] | undefined,
): SessionSnapshot {
  const tz = MARKET_TIME_ZONES[home];
  const { open, close } = SESSION_WINDOWS[home];
  const holidays = holidaysAsMap(weeksHolidays);
  const { dateKey, minutes } = zonedParts(tz, now);
  const sessionToday = isTradingDateKey(dateKey, holidays);

  if (sessionToday && minutes < open) {
    const boundaryEpoch = epochAtZonedMinutes(tz, dateKey, open);
    return {
      state: 'pre',
      sessionToday: true,
      windowMinutes: close - open,
      boundaryEpoch,
      minutesToBoundary: Math.max(0, (boundaryEpoch - now) / 60_000),
      boundaryMinutesOfDay: open,
    };
  }
  if (sessionToday && minutes < close) {
    const boundaryEpoch = epochAtZonedMinutes(tz, dateKey, close);
    return {
      state: 'open',
      sessionToday: true,
      windowMinutes: close - open,
      boundaryEpoch,
      minutesToBoundary: Math.max(0, (boundaryEpoch - now) / 60_000),
      boundaryMinutesOfDay: close,
    };
  }
  // No session right now (pre on a closed day, after-close, weekend,
  // holiday): find the next opening strictly in the future — starting at
  // tomorrow, because a boundary earlier today has already passed and a
  // countdown to "this morning 09:00" would read as 0m forever.
  for (let forward = 1; forward <= 31; forward++) {
    const candidateKey = offsetDateKey(dateKey, forward);
    if (!isTradingDateKey(candidateKey, holidays)) continue;
    const boundaryEpoch = epochAtZonedMinutes(tz, candidateKey, open);
    return {
      state: 'closed',
      sessionToday,
      windowMinutes: close - open,
      boundaryEpoch,
      minutesToBoundary: Math.max(0, (boundaryEpoch - now) / 60_000),
      boundaryMinutesOfDay: open,
    };
  }
  // No session within a month (holiday-stuck feed): honest dead state.
  return {
    state: 'closed',
    sessionToday: false,
    windowMinutes: close - open,
    boundaryEpoch: now,
    minutesToBoundary: 0,
    boundaryMinutesOfDay: open,
  };
}
