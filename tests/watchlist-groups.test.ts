import { describe, expect, it } from 'vitest';
import {
  assignWatchlistGroup,
  dropTickerFromGroups,
  groupNamesInUse,
  normalizeGroupName,
  parseWatchlistGroups,
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
