// ─── shared/watchlist-groups.ts ──────────────────────────────────────────────
// Optional group tagging over the flat watchlist. The watchlist itself stays
// the flat `boz_favorites` array every page reads; groups live beside it as a
// `ticker → group name` map, so adding/grouping/removing stays fully local
// and every consumer that doesn't care about groups is untouched.
//
// Pure data: no DOM, no storage I/O — callers own persistence (localStorage)
// and only hand maps in, get new maps out. Immutability is deliberate: one
// bad assignment can never mutate the state a React tree is rendering.

/** ticker → group name. A ticker missing from the map is simply ungrouped. */
export type WatchlistGroups = Record<string, string>;

/** Group names are labels, not prose — kept short enough for a row chip. */
export const MAX_GROUP_NAME_LENGTH = 24;
/** Cap on distinct groups so the chip row never scrolls sideways. */
export const MAX_GROUPS = 20;

/** Trim, collapse inner whitespace and cap the length; '' when nothing usable
 *  remains (callers treat '' as "no group"). */
export function normalizeGroupName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_GROUP_NAME_LENGTH);
}

/** Validate a parsed-JSON payload into a clean ticker→group map: string keys,
 *  non-empty group names, trimmed values, malformed rows dropped silently —
 *  a corrupted localStorage entry degrades to fewer groups, never a crash. */
export function parseWatchlistGroups(raw: unknown): WatchlistGroups {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const result: WatchlistGroups = {};
  for (const [ticker, group] of Object.entries(raw)) {
    if (!ticker.trim()) continue;
    if (typeof group !== 'string') continue;
    const name = normalizeGroupName(group);
    if (!name) continue;
    result[ticker.trim()] = name;
  }
  return result;
}

/** Assign one ticker to a group (or clear the assignment with an empty
 *  name). Enforces the group cap only for genuinely NEW group names, so
 *  existing groups keep working even if ignores pile up. Returns the same
 *  map when nothing changes. */
export function assignWatchlistGroup(
  map: WatchlistGroups,
  ticker: string,
  group: string,
): WatchlistGroups {
  const name = normalizeGroupName(group);
  if (!ticker.trim()) return map;
  if (!name) return dropTickerFromGroups(map, ticker);

  const alreadyCounted = Object.values(map).includes(name);
  if (!alreadyCounted && countGroups(map) >= MAX_GROUPS) return map;
  if (map[ticker] === name) return map;

  return { ...map, [ticker]: name };
}

/** When a ticker leaves the watchlist, its (possibly empty) group goes too —
 *  groups only exist through the tickers that carry them. */
export function dropTickerFromGroups(map: WatchlistGroups, ticker: string): WatchlistGroups {
  if (!(ticker in map)) return map;
  const next = { ...map };
  delete next[ticker];
  return next;
}

/** Distinct group names, in first-seen order — stable chip ordering that
 *  never reshuffles when a group's tickers come and go. */
export function groupNamesInUse(map: WatchlistGroups): string[] {
  const names: string[] = [];
  for (const name of Object.values(map)) {
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function countGroups(map: WatchlistGroups): number {
  return groupNamesInUse(map).length;
}

/** The watchlist rows to show: everything for `null`/'' (the ALL view), or
 *  only the tickers carrying that group — always in watchlist order. */
export function tickersForGroup(
  tickers: string[],
  map: WatchlistGroups,
  group: string | null,
): string[] {
  if (!group) return [...tickers];
  return tickers.filter((ticker) => map[ticker] === group);
}
