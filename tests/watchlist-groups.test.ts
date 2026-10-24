import { describe, expect, it } from 'vitest';
import {
  assignWatchlistGroup,
  createFolder,
  deleteFolder,
  dropTickerFromGroups,
  foldersInUse,
  groupNamesInUse,
  normalizeGroupName,
  parseWatchlistFolders,
  parseWatchlistGroups,
  renameFolder,
  tickersForGroup,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUPS,
} from '../src/shared/watchlist-groups.js';

describe('group name normalization', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(normalizeGroupName('  AI   plays')).toBe('AI plays');
    expect(normalizeGroupName(`x`.repeat(40))).toHaveLength(MAX_GROUP_NAME_LENGTH);
    expect(normalizeGroupName('   ')).toBe('');
  });
});

describe('watchlist groups map validation', () => {
  it('keeps string ticker→name rows and drops malformed ones silently', () => {
    const parsed = parseWatchlistGroups({
      NFNT: ' AI ', // trimmed
      '': 'ghost', // no ticker → dropped
      BROKEN: 42, // non-string name → dropped
      EMPTY: '   ', // empty name → dropped
    });
    expect(parsed).toEqual({ NFNT: 'AI' });
  });

  it('degrades non-object payloads to an empty map, never a crash', () => {
    expect(parseWatchlistGroups(null)).toEqual({});
    expect(parseWatchlistGroups(['a'])).toEqual({});
    expect(parseWatchlistGroups('garbage')).toEqual({});
  });
});

describe('assigning and clearing', () => {
  it('assigns a group and reports first-seen order', () => {
    let map = assignWatchlistGroup({}, 'NFNT', 'AI');
    map = assignWatchlistGroup(map, 'AAPL', 'Long term');
    map = assignWatchlistGroup(map, 'GOTO', 'AI');
    expect(groupNamesInUse(map)).toEqual(['AI', 'Long term']);
    expect(map['GOTO']).toBe('AI');
  });

  it('an empty group name clears the assignment instead of inventing a group', () => {
    const map = assignWatchlistGroup({ NFNT: 'AI' }, 'NFNT', '   ');
    expect('NFNT' in map).toBe(false);
  });

  it('re-assignment moves a ticker between groups without touching others', () => {
    const map = assignWatchlistGroup({ NFNT: 'AI', AAPL: 'Long term' }, 'NFNT', 'Long term');
    expect(map['NFNT']).toBe('Long term');
    expect(map['AAPL']).toBe('Long term');
  });

  it('is immutable: the input map is never mutated', () => {
    const before = { NFNT: 'AI' };
    assignWatchlistGroup(before, 'AAPL', 'Long term');
    expect(before).toEqual({ NFNT: 'AI' });
  });

  it('rejects a NEW group beyond the cap but keeps resizing existing ones', () => {
    let map: Record<string, string> = {};
    for (let i = 0; i < MAX_GROUPS; i += 1) {
      map = assignWatchlistGroup(map, `T${i}`, `G${i}`);
    }
    expect(groupNamesInUse(map)).toHaveLength(MAX_GROUPS);
    // A 21st NEW group is refused…
    expect(assignWatchlistGroup(map, 'T99', 'overflow')).toBe(map);
    // …while a ticker MOVING into an existing group still works.
    const moved = assignWatchlistGroup(map, 'T99', 'G0');
    expect(moved['T99']).toBe('G0');
  });
});

describe('leaving the watchlist', () => {
  it('drops the ticker and its group binding, returns the same map if absent', () => {
    const map = { NFNT: 'AI', AAPL: 'Long term' };
    expect(dropTickerFromGroups(map, 'NFNT')).toEqual({ AAPL: 'Long term' });
    expect(dropTickerFromGroups(map, 'NOT-HERE')).toBe(map);
  });
});

describe('the filtered watchlist rows', () => {
  const tickers = ['NFNT', 'AAPL', 'GOTO'];

  it('ALL (null) shows everything in watchlist order', () => {
    expect(tickersForGroup(tickers, { NFNT: 'AI' }, null)).toEqual(tickers);
  });

  it('a named group keeps only its tickers, still in watchlist order', () => {
    const map = { GOTO: 'AI', NFNT: 'AI', AAPL: 'Long term' };
    expect(tickersForGroup(tickers, map, 'AI')).toEqual(['NFNT', 'GOTO']);
    expect(tickersForGroup(tickers, map, 'Long term')).toEqual(['AAPL']);
  });

  it('an empty group yields rows without a crash', () => {
    expect(tickersForGroup(tickers, {}, 'AI')).toEqual([]);
  });
});

describe('the persistent folder list', () => {
  it('parses a stored list: strings only, trimmed, deduped, capped', () => {
    expect(parseWatchlistFolders([' AI ', 'AI', 42, '', 'Long term'])).toEqual(['AI', 'Long term']);
    expect(parseWatchlistFolders('garbage')).toEqual([]);
    expect(parseWatchlistFolders(null)).toEqual([]);
    expect(parseWatchlistFolders({ not: 'an array' })).toEqual([]);
    const many = Array.from({ length: MAX_GROUPS + 3 }, (_, i) => `G${i}`);
    expect(parseWatchlistFolders(many)).toHaveLength(MAX_GROUPS);
  });

  it('integrates legacy in-use group names into the rendered list', () => {
    expect(foldersInUse(['AI'], { AAPL: 'Long term' })).toEqual(['AI', 'Long term']);
    expect(foldersInUse([], {})).toEqual([]);
    // Legacy names never shadow or reorder the persisted list.
    expect(foldersInUse(['AI', 'Long term'], { NFNT: 'AI' })).toEqual(['AI', 'Long term']);
  });

  it('creates real folders — they exist before any ticker carries them', () => {
    const first = createFolder([], 'AI');
    expect(first.created).toBe(true);
    expect(first.folders).toEqual(['AI']);

    // Duplicate (loose whitespace included): not created, still points there.
    const dup = createFolder(first.folders, ' AI ');
    expect(dup.created).toBe(false);
    expect(dup.folders).toEqual(['AI']);
    expect(dup.name).toBe('AI');

    // Blank input: nothing invented.
    const empty = createFolder(first.folders, '   ');
    expect(empty.created).toBe(false);
    expect(empty.name).toBe('');
    expect(empty.folders).toEqual(['AI']);

    // Cap: the bar refuses a NEW folder while keeping existing ones.
    const full = parseWatchlistFolders(Array.from({ length: MAX_GROUPS }, (_, i) => `G${i}`));
    const overflow = createFolder(full, 'overflow');
    expect(overflow.created).toBe(false);
    expect(overflow.folders).toHaveLength(MAX_GROUPS);
  });

  it('renames a folder and re-points its tickers', () => {
    const base = renameFolder(['AI', 'Long term'], { NFNT: 'AI', AAPL: 'Long term' }, 'AI', 'ML');
    expect(base.renamed).toBe(true);
    expect(base.folders).toEqual(['ML', 'Long term']);
    expect(base.groups).toEqual({ NFNT: 'ML', AAPL: 'Long term' });

    // A legacy name joins the list under its new one.
    const legacy = renameFolder([], { NI: 'AI' }, 'AI', 'ML');
    expect(legacy.folders).toEqual(['ML']);
    expect(legacy.groups).toEqual({ NI: 'ML' });
  });

  it('renaming onto an existing folder merges onto the target', () => {
    const merged = renameFolder(['AI', 'Long term'], { NFNT: 'AI' }, 'AI', ' Long term ');
    expect(merged.folders).toEqual(['Long term']);
    expect(merged.groups).toEqual({ NFNT: 'Long term' });
  });

  it('refuses blank, self, and unknown renames without changing anything', () => {
    const folders = ['AI'];
    const map: Record<string, string> = { NFNT: 'AI' };
    expect(renameFolder(folders, map, 'AI', '   ')).toEqual({ folders, groups: map, renamed: false });
    expect(renameFolder(folders, map, 'AI', 'AI').renamed).toBe(false);
    expect(renameFolder(folders, map, 'ghost', 'ML').renamed).toBe(false);
    expect(renameFolder(folders, map, 'ghost', 'ML').folders).toEqual(folders);
  });

  it('deletes a folder from the bar and releases its tickers, ungrouped', () => {
    const gone = deleteFolder(['AI', 'Long term'], { NFNT: 'AI', AAPL: 'Long term' }, 'AI');
    expect(gone.folders).toEqual(['Long term']);
    expect(gone.groups).toEqual({ AAPL: 'Long term' });
    // Deleting a name that only ever lived in the map still cleans it up.
    const legacy = deleteFolder([], { NFNT: 'AI' }, 'AI');
    expect(legacy.folders).toEqual([]);
    expect(legacy.groups).toEqual({});
  });
});
