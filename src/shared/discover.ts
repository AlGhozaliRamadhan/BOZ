// ─── shared/discover.ts ─────────────────────────────────────────────────────
// Pure helpers for the Discover + Dashboard split: recent tickers
// (last-viewed symbols) and in-app big-move detection. No DOM here so API
// routes and client pages can share them. Storage stays localStorage-only;
// notifications are in-app banners, never browser Notification API.

export const RECENT_TICKERS_KEY = 'boz_recent_tickers';
export const CHAT_PREFILL_KEY = 'boz_chat_prefill';
export const MAX_RECENT_TICKERS = 8;

/** Minimal storage surface so tests can pass a fake record. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStringArray(storage: KeyValueStorage, key: string): string[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t: unknown): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

/** Most-recent-first list of upper-cased tickers, de-duplicated + capped. */
export function loadRecentTickers(storage: KeyValueStorage): string[] {
  return readStringArray(storage, RECENT_TICKERS_KEY)
    .map(t => t.toUpperCase())
    .filter((t, i, arr) => t.length > 0 && arr.indexOf(t) === i)
    .slice(0, MAX_RECENT_TICKERS);
}

/** Prepend a ticker to the recent list; returns the updated list. */
export function recordRecentTicker(storage: KeyValueStorage, ticker: string): string[] {
  const clean = ticker.trim().toUpperCase();
  if (!clean) return loadRecentTickers(storage);
  const next = [clean, ...loadRecentTickers(storage).filter(t => t !== clean)].slice(
    0,
    MAX_RECENT_TICKERS,
  );
  try {
    storage.setItem(RECENT_TICKERS_KEY, JSON.stringify(next));
  } catch {
    // Persistence is best-effort; callers still get the in-memory list.
  }
  return next;
}

/** Stash a prompt for /chat to pick up on mount (session scope). */
export function stashChatPrefill(storage: KeyValueStorage, prompt: string): void {
  const clean = prompt.trim();
  if (!clean) return;
  try {
    storage.setItem(CHAT_PREFILL_KEY, clean);
  } catch {
    // Ignore persistence failures.
  }
}

/** Read + clear the stashed chat prompt so it only applies once. */
export function takeChatPrefill(storage: KeyValueStorage): string | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CHAT_PREFILL_KEY);
  } catch {
    return null;
  }
  if (!raw || !raw.trim()) return null;
  try {
    storage.setItem(CHAT_PREFILL_KEY, '');
  } catch {
    // Clearing is best-effort.
  }
  return raw;
}

export interface MoverQuote {
  ticker: string;
  changePercent: number | null | undefined;
}

/**
 * Symbols whose absolute day change meets the threshold. Pure diff of two
 * snapshots so pages can decide when to show an in-app alert banner.
 */
export function findBigMovers(
  quotes: MoverQuote[],
  thresholdPct = 3,
): string[] {
  return quotes
    .filter(
      q =>
        typeof q.changePercent === 'number' &&
        Number.isFinite(q.changePercent) &&
        Math.abs(q.changePercent) >= thresholdPct,
    )
    .map(q => q.ticker.toUpperCase());
}
