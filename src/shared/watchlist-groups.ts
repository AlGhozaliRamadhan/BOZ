// ─── shared/watchlist-groups.ts ──────────────────────────────────────────────
// Optional group tagging over the flat watchlist. The watchlist itself stays
// the flat `boz_favorites` array every page reads; groups live beside it as a
// `ticker → group name` map, so adding/grouping/removing stays fully local
// and every consumer that doesn't care about groups is untouched.
//
// A folder bar rides on top: folder names persist in their own ordered list,
// so a folder is born the moment it is created — even with zero tickers —
// and lasts until it is deleted. The ticker map is unchanged for every
// existing consumer; an in-use name that predates the list renders anyway.
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

/** When a ticker leaves the watchlist, its assignment leaves with it —
 *  the folder itself stays on the bar until it is deleted. */
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

// ── Folders: the persistent group bar ────────────────────────────────────────
// Groups started as tags that existed only through their tickers: a freshly
// typed group vanished until its first ticker arrived, so a create made no
// folder at all. Folders now persist as their own ordered name list beside
// the ticker map, and the map keeps working exactly as before.

/** Ordered folder names, as persisted (folder list key) and rendered. */
export type WatchlistFolders = string[];

/** Validate a parsed-JSON folder list: strings only, normalized,
 *  de-duplicated (first occurrence wins), capped at MAX_GROUPS — a corrupted
 *  entry degrades to fewer folders, never a crash. */
export function parseWatchlistFolders(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const name = normalizeGroupName(entry);
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}

/** The names the bar renders: the persisted list first, then any in-use group
 *  names recorded before folders existed — they migrate in without loss. */
export function foldersInUse(
  folders: readonly string[],
  map: WatchlistGroups,
): string[] {
  const out = [...folders];
  for (const name of groupNamesInUse(map)) {
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export interface CreateFolderResult {
  folders: string[];
  /** The normalized name ('' when nothing usable was typed). */
  name: string;
  /** False for empty names, duplicates, or a bar already at the cap. */
  created: boolean;
}

/** Create a folder if the name is fresh and the bar is under the cap.
 *  The folder exists — next to ALL — even with zero tickers assigned. */
export function createFolder(
  folders: readonly string[],
  raw: string,
): CreateFolderResult {
  const name = normalizeGroupName(raw);
  if (!name || folders.includes(name) || folders.length >= MAX_GROUPS) {
    return { folders: [...folders], name, created: false };
  }
  return { folders: [...folders, name], name, created: true };
}

export interface RenameFolderResult {
  folders: string[];
  groups: WatchlistGroups;
  renamed: boolean;
}

/** Rename a folder and re-point its tickers. Renaming onto an existing
 *  folder merges: every ticker moves onto the target and the emptied name
 *  leaves the bar. A legacy name (in the map but not the list) joins the
 *  list under its new name. An unknown folder is refused without inventing
 *  anything. */
export function renameFolder(
  folders: readonly string[],
  map: WatchlistGroups,
  oldName: string,
  raw: string,
): RenameFolderResult {
  const nextName = normalizeGroupName(raw);
  const unchanged = { folders: [...folders], groups: { ...map }, renamed: false };
  if (!oldName || !nextName || nextName === oldName) return unchanged;
  // A rename must meet an existing folder somewhere: the bar or the map.
  if (!folders.includes(oldName) && !Object.values(map).includes(oldName)) {
    return unchanged;
  }
  const groups: WatchlistGroups = {};
  for (const [ticker, group] of Object.entries(map)) {
    groups[ticker] = group === oldName ? nextName : group;
  }
  const merged = folders.includes(oldName)
    ? folders.map((name) => (name === oldName ? nextName : name))
    : [...folders, nextName];
  const foldersNext: string[] = [];
  for (const name of merged) {
    if (!foldersNext.includes(name)) foldersNext.push(name);
  }
  return { folders: foldersNext, groups, renamed: true };
}

/** Delete a folder: it leaves the bar and releases its tickers — they stay
 *  starred, just ungrouped. */
export function deleteFolder(
  folders: readonly string[],
  map: WatchlistGroups,
  name: string,
): { folders: string[]; groups: WatchlistGroups } {
  const groups: WatchlistGroups = {};
  for (const [ticker, group] of Object.entries(map)) {
    if (group !== name) groups[ticker] = group;
  }
  return { folders: folders.filter((folder) => folder !== name), groups };
}
