import { describe, it, expect } from 'vitest';
import {
  buildSocialSearchQuery,
  resolveStockTwitsSymbol,
  resolveSymbol,
} from '../src/shared/market-constants.js';

describe('resolveSymbol', () => {
  it('resolves aliases and passthrough symbols', () => {
    expect(resolveSymbol('BITCOIN')).toBe('BTC-USD');
    expect(resolveSymbol('MSFT')).toBe('MSFT');
    expect(resolveSymbol('SOL-USD')).toBe('SOL-USD');
    expect(resolveSymbol('BRK-B')).toBe('BRK-B');
    expect(resolveSymbol('^GSPC')).toBe('^GSPC');
    expect(resolveSymbol('GC=F')).toBe('GC=F');
  });

  it('returns null for unknown inputs', () => {
    expect(resolveSymbol('$$$')).toBeNull();
    expect(resolveSymbol('palantir')).toBeNull();
  });
});

describe('resolveStockTwitsSymbol', () => {
  it('converts Yahoo crypto pairs to StockTwits symbols', () => {
    expect(resolveStockTwitsSymbol('BTC-USD')).toBe('BTC.X');
    expect(resolveStockTwitsSymbol('BITCOIN')).toBe('BTC.X');
    expect(resolveStockTwitsSymbol('ETH')).toBe('ETH.X');
  });

  it('keeps simple equities and skips Yahoo-only instruments', () => {
    expect(resolveStockTwitsSymbol('NVDA')).toBe('NVDA');
    expect(resolveStockTwitsSymbol('^GSPC')).toBeNull();
    expect(resolveStockTwitsSymbol('GC=F')).toBeNull();
  });
});

describe('buildSocialSearchQuery', () => {
  it('uses readable crypto aliases instead of Yahoo pair symbols', () => {
    expect(buildSocialSearchQuery('BTC-USD')).toBe('BTC OR Bitcoin OR $BTC');
    expect(buildSocialSearchQuery('SOLANA')).toBe('SOL OR Solana OR $SOL');
  });

  it('uses cashtags for simple equities', () => {
    expect(buildSocialSearchQuery('NVDA')).toBe('NVDA OR $NVDA');
  });
});
