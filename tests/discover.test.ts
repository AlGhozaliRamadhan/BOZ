import { describe, expect, it } from 'vitest';
import {
  findBigMovers,
  loadRecentTickers,
  recordRecentTicker,
  takeChatPrefill,
  stashChatPrefill,
  MAX_RECENT_TICKERS,
  type KeyValueStorage,
} from '../src/shared/discover.js';

function createStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const values = { ...initial };
  return {
    getItem: key => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe('discover helpers', () => {
  it('records recent tickers most-recent-first without duplicates', () => {
    const storage = createStorage();
    recordRecentTicker(storage, 'nvda');
    recordRecentTicker(storage, 'BBCA.JK');
    recordRecentTicker(storage, 'NVDA');

    expect(loadRecentTickers(storage)).toEqual(['NVDA', 'BBCA.JK']);
  });

  it('caps the recent list and ignores corrupt storage', () => {
    const storage = createStorage();
    for (let i = 0; i < MAX_RECENT_TICKERS + 4; i++) {
      recordRecentTicker(storage, `T${i}`);
    }
    expect(loadRecentTickers(storage)).toHaveLength(MAX_RECENT_TICKERS);
    expect(loadRecentTickers(storage)[0]).toBe(`T${MAX_RECENT_TICKERS + 3}`);

    expect(loadRecentTickers(createStorage({ boz_recent_tickers: 'not-json' }))).toEqual([]);
  });

  it('takes a stashed chat prompt exactly once', () => {
    const storage = createStorage();
    stashChatPrefill(storage, '  /intraday NVDA  ');
    expect(takeChatPrefill(storage)).toBe('/intraday NVDA');
    expect(takeChatPrefill(storage)).toBeNull();
  });

  it('flags only movers meeting the threshold', () => {
    expect(
      findBigMovers(
        [
          { ticker: 'NVDA', changePercent: 4.2 },
          { ticker: 'SPY', changePercent: -3.0 },
          { ticker: 'QQQ', changePercent: 1.5 },
          { ticker: 'BTC-USD', changePercent: null },
        ],
        3,
      ),
    ).toEqual(['NVDA', 'SPY']);
  });
});
