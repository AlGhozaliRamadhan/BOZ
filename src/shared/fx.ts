// ─── shared/fx.ts ─────────────────────────────────────────────────────────────
// Single source of truth for FX pair identity and the FX session clock.
//
// Three things live here and nowhere else:
//   1. The pair registry — canonical Yahoo symbol, display form, pip size and
//      the class the screener filters on.
//   2. Parsing — every spelling a user or a provider can hand us ("EURUSD",
//      "eur/usd", "EURUSD=X", "JPY=X") resolves to one registry entry.
//   3. The session clock — Sydney/Tokyo/London/New York, computed from IANA
//      time zones so daylight saving is never hard-coded.
//
// Pure: no network, no DOM, no side effects. Safe to import from an API route,
// the scanner, a client component or a chat tool.

export type FxPairClass = 'major' | 'cross' | 'asia' | 'exotic';

export interface FxPair {
  /** Six-letter ISO code, e.g. `EURUSD`. */
  code: string;
  /** Display form, e.g. `EUR/USD`. */
  pair: string;
  base: string;
  quote: string;
  /** Canonical Yahoo Finance symbol, e.g. `EURUSD=X` or `JPY=X`. */
  yahoo: string;
  class: FxPairClass;
  /** Decimal places the pair is conventionally quoted to. */
  precision: number;
  /** One pip in quote-currency terms. */
  pipSize: number;
  nickname?: string;
}

/**
 * Conventional quote precision by currency. Five decimals is the FX default;
 * JPY crosses quote to three, and the high-denomination Asian units (IDR, KRW)
 * quote to two because a single unit there is already far below a pip.
 */
const QUOTE_PRECISION: Record<string, number> = {
  JPY: 3,
  IDR: 2,
  KRW: 2,
  TWD: 4, THB: 4, PHP: 4, CNY: 4, MYR: 4, SGD: 4, INR: 4, HKD: 4,
  MXN: 4, ZAR: 4, TRY: 4, BRL: 4, PLN: 4, HUF: 4, CZK: 4,
};

function precisionFor(quote: string): number {
  return QUOTE_PRECISION[quote] ?? 5;
}

/**
 * One pip. Four-decimal pairs move in 0.0001; JPY crosses in 0.01. The two
 * two-decimal Asian units (IDR, KRW) are quoted in whole units, so their
 * smallest conventional increment is 1.
 */
function pipSizeFor(precision: number): number {
  if (precision >= 4) return 0.0001;
  if (precision === 3) return 0.01;
  return 1;
}

function define(base: string, quote: string, cls: FxPairClass, nickname?: string): FxPair {
  const code = `${base}${quote}`;
  const precision = precisionFor(quote);
  return {
    code,
    pair: `${base}/${quote}`,
    base,
    quote,
    // Yahoo quotes USD-base pairs as `<quote>=X` (JPY=X) and everything else
    // as `<base><quote>=X` (EURUSD=X). Getting this wrong silently returns
    // an unrelated equity, so it is derived, never hand-written.
    yahoo: base === 'USD' ? `${quote}=X` : `${code}=X`,
    class: cls,
    precision,
    pipSize: pipSizeFor(precision),
    nickname,
  };
}

export const FX_PAIRS: readonly FxPair[] = [
  // ── Majors ────────────────────────────────────────────────────────────────
  define('EUR', 'USD', 'major', 'Fiber'),
  define('GBP', 'USD', 'major', 'Cable'),
  define('USD', 'JPY', 'major', 'Ninja'),
  define('USD', 'CHF', 'major', 'Swissy'),
  define('USD', 'CAD', 'major', 'Loonie'),
  define('AUD', 'USD', 'major', 'Aussie'),
  define('NZD', 'USD', 'major', 'Kiwi'),

  // ── Crosses ───────────────────────────────────────────────────────────────
  define('EUR', 'GBP', 'cross'),
  define('EUR', 'JPY', 'cross'),
  define('EUR', 'CHF', 'cross'),
  define('EUR', 'AUD', 'cross'),
  define('EUR', 'CAD', 'cross'),
  define('EUR', 'NZD', 'cross'),
  define('GBP', 'JPY', 'cross'),
  define('GBP', 'CHF', 'cross'),
  define('GBP', 'AUD', 'cross'),
  define('GBP', 'CAD', 'cross'),
  define('GBP', 'NZD', 'cross'),
  define('AUD', 'JPY', 'cross'),
  define('AUD', 'CAD', 'cross'),
  define('AUD', 'CHF', 'cross'),
  define('AUD', 'NZD', 'cross'),
  define('CAD', 'JPY', 'cross'),
  define('CAD', 'CHF', 'cross'),
  define('CHF', 'JPY', 'cross'),
  define('NZD', 'JPY', 'cross'),
  define('NZD', 'CAD', 'cross'),
  define('NZD', 'CHF', 'cross'),

  // ── Asia-Pacific ──────────────────────────────────────────────────────────
  define('USD', 'IDR', 'asia'),
  define('USD', 'SGD', 'asia'),
  define('USD', 'MYR', 'asia'),
  define('USD', 'THB', 'asia'),
  define('USD', 'PHP', 'asia'),
  define('USD', 'KRW', 'asia'),
  define('USD', 'CNY', 'asia'),
  define('USD', 'HKD', 'asia'),
  define('USD', 'INR', 'asia'),
  define('USD', 'TWD', 'asia'),

  // ── Exotics ───────────────────────────────────────────────────────────────
  define('USD', 'MXN', 'exotic'),
  define('USD', 'ZAR', 'exotic'),
  define('USD', 'TRY', 'exotic'),
  define('USD', 'BRL', 'exotic'),
  define('USD', 'PLN', 'exotic'),
  define('USD', 'SEK', 'exotic'),
  define('USD', 'NOK', 'exotic'),
  define('USD', 'DKK', 'exotic'),
];

export const FX_SECTORS: readonly FxPairClass[] = ['major', 'cross', 'asia', 'exotic'];

export const FX_SECTOR_LABEL: Record<FxPairClass, string> = {
  major: 'Majors',
  cross: 'Crosses',
  asia: 'Asia',
  exotic: 'Exotics',
};

const BY_CODE = new Map<string, FxPair>();
const BY_YAHOO = new Map<string, FxPair>();
for (const pair of FX_PAIRS) {
  BY_CODE.set(pair.code, pair);
  BY_YAHOO.set(pair.yahoo.toUpperCase(), pair);
}

/** Registry entry for a six-letter code, or null. */
export function fxPairByCode(code: string): FxPair | null {
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/**
 * Resolve any FX spelling to a registry entry.
 *
 * Accepts `EURUSD`, `eur/usd`, `EUR-USD`, `EUR_USD`, `EURUSD=X`, `JPY=X` and
 * whitespace-padded variants. Returns null for anything that is not a pair in
 * the registry — deliberately, so a caller can branch on "is this FX?" without
 * a second guess.
 */
export function parseFxSymbol(raw: string): FxPair | null {
  const upper = (raw ?? '').trim().toUpperCase();
  if (!upper) return null;

  const directYahoo = BY_YAHOO.get(upper);
  if (directYahoo) return directYahoo;

  // `EUR/USD=X` → `EURUSD`, `EUR-USD` → `EURUSD`.
  const code = upper.replace(/=X$/, '').replace(/[^A-Z]/g, '');
  if (code.length === 6) {
    const pair = BY_CODE.get(code);
    if (pair) return pair;
  }

  return null;
}

/** True when the symbol is a pair this app treats as FX. */
export function isFxSymbol(raw: string): boolean {
  return parseFxSymbol(raw) !== null;
}

/**
 * Normalise any FX spelling to the canonical Yahoo symbol.
 * Returns null when the input is not FX, so callers can keep their existing
 * non-FX fallback untouched.
 */
export function resolveFxSymbol(raw: string): string | null {
  return parseFxSymbol(raw)?.yahoo ?? null;
}

/** `EURUSD=X` → `EUR/USD`. Unknown symbols pass through unchanged. */
export function fxDisplaySymbol(raw: string): string {
  return parseFxSymbol(raw)?.pair ?? raw;
}

/** Format a rate with the pair's conventional precision. */
export function formatFxRate(raw: string, value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const pair = parseFxSymbol(raw);
  const precision = pair?.precision ?? 4;
  return value.toFixed(precision);
}

/** Convert an absolute price move into pips (`0.0025` on EUR/USD → `25.0`). */
export function fxPips(raw: string, delta: number | null | undefined): number | null {
  const pair = parseFxSymbol(raw);
  if (!pair || typeof delta !== 'number' || !Number.isFinite(delta)) return null;
  return delta / pair.pipSize;
}

/** Format a pip distance with one decimal (`+25.0 pips`). */
export function formatFxPips(raw: string, delta: number | null | undefined): string {
  const pips = fxPips(raw, delta);
  if (pips === null) return '—';
  const sign = pips > 0 ? '+' : '';
  return `${sign}${pips.toFixed(1)} pips`;
}

// ─── Session clock ───────────────────────────────────────────────────────────

export type FxSessionKey = 'sydney' | 'tokyo' | 'london' | 'newyork';

export interface FxSessionDef {
  key: FxSessionKey;
  city: string;
  timeZone: string;
  /** Local opening hour, 24h. */
  openHour: number;
  /** Local closing hour, 24h. */
  closeHour: number;
}

/**
 * The four rolling FX centres. Hours are local wall-clock, which is how the
 * desks actually run; the IANA zone carries the DST rule.
 */
export const FX_SESSIONS: readonly FxSessionDef[] = [
  { key: 'sydney', city: 'Sydney', timeZone: 'Australia/Sydney', openHour: 7, closeHour: 16 },
  { key: 'tokyo', city: 'Tokyo', timeZone: 'Asia/Tokyo', openHour: 9, closeHour: 18 },
  { key: 'london', city: 'London', timeZone: 'Europe/London', openHour: 8, closeHour: 17 },
  { key: 'newyork', city: 'New York', timeZone: 'America/New_York', openHour: 8, closeHour: 17 },
];

export interface FxSessionState extends FxSessionDef {
  open: boolean;
  /** Local wall-clock time, `HH:MM`. */
  localTime: string;
  /** Minutes until this desk opens; null while it is already open. */
  opensInMinutes: number | null;
  /** Minutes until this desk closes; null while it is closed. */
  closesInMinutes: number | null;
}

export interface FxMarketEvent {
  session: FxSessionKey;
  city: string;
  action: 'open' | 'close';
  inMinutes: number;
}

export interface FxMarketStatus {
  open: boolean;
  sessions: FxSessionState[];
  /** The next desk to open or close, whichever comes first. */
  nextEvent: FxMarketEvent | null;
  asOf: string;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

interface LocalClock {
  /** 0 = Sunday … 6 = Saturday, in the target zone. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  /** `HH:MM`, zero-padded. */
  clock: string;
}

function localClock(timeZone: string, at: Date): LocalClock {
  const parts = formatterFor(timeZone).formatToParts(at);
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekday = WEEKDAY_INDEX[part.value] ?? 0;
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
  }
  const minutes = hour * 60 + minute;
  return {
    weekday,
    minutes,
    clock: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/** Minutes until the desk next opens, counting only Mon–Fri. */
function minutesUntilOpen(clock: LocalClock, openHour: number): number {
  const openMinutes = openHour * 60;
  if (isWeekday(clock.weekday) && clock.minutes < openMinutes) {
    return openMinutes - clock.minutes;
  }
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    if (isWeekday((clock.weekday + ahead) % 7)) {
      return ahead * 1440 + (openMinutes - clock.minutes);
    }
  }
  return 7 * 1440;
}

/**
 * Current state of every desk plus the next transition.
 *
 * A desk is open when its local weekday is Mon–Fri and its clock sits inside
 * [openHour, closeHour). The market as a whole is open when at least one desk
 * is, which reproduces the real Sunday-night Sydney open and Friday-night New
 * York close without a separate weekend rule.
 */
export function fxMarketStatus(now: Date = new Date()): FxMarketStatus {
  const sessions: FxSessionState[] = FX_SESSIONS.map(def => {
    const clock = localClock(def.timeZone, now);
    const openMinutes = def.openHour * 60;
    const closeMinutes = def.closeHour * 60;
    const open = isWeekday(clock.weekday) && clock.minutes >= openMinutes && clock.minutes < closeMinutes;
    return {
      ...def,
      open,
      localTime: clock.clock,
      opensInMinutes: open ? null : minutesUntilOpen(clock, def.openHour),
      closesInMinutes: open ? closeMinutes - clock.minutes : null,
    };
  });

  const events: FxMarketEvent[] = sessions.map(session => ({
    session: session.key,
    city: session.city,
    action: session.open ? 'close' : 'open',
    inMinutes: session.open ? (session.closesInMinutes ?? 0) : (session.opensInMinutes ?? 0),
  }));
  events.sort((a, b) => a.inMinutes - b.inMinutes);

  return {
    open: sessions.some(session => session.open),
    sessions,
    nextEvent: events[0] ?? null,
    asOf: now.toISOString(),
  };
}

/** `135` → `2h 15m`; `45` → `45m`. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return '—';
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
