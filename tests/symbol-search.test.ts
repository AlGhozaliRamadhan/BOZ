import { describe, it, expect } from 'vitest';
import {
  buildSymbolProbes,
  classifySymbolMarket,
  clampSearchLimit,
  clampSearchOffset,
  filterHitsByMarket,
  normalizeSymbolQuery,
  paginateHits,
  parseSymbolMarketFilter,
  rankSymbolHits,
  SYMBOL_SEARCH_MAX_LIMIT,
  type SymbolSearchHit,
} from '../src/shared/symbol-search.js';

function hit(partial: Partial<SymbolSearchHit> & { symbol: string }): SymbolSearchHit {
  return {
    name: partial.symbol,
    exchange: '',
    type: '',
    market: 'us',
    source: 'yahoo',
    ...partial,
  };
}

describe('classifySymbolMarket', () => {
  it('trusts the instrument class Yahoo reports', () => {
    expect(classifySymbolMarket('BTC-USD', 'CRYPTOCURRENCY')).toBe('crypto');
    expect(classifySymbolMarket('^GSPC', 'INDEX')).toBe('index');
    expect(classifySymbolMarket('GC=F', 'FUTURE')).toBe('macro');
  });

  it('classifies registered pairs as FX, not macro', () => {
    // Yahoo labels EURUSD=X CURRENCY; the pair registry is the more useful answer.
    expect(classifySymbolMarket('EURUSD=X', 'CURRENCY')).toBe('fx');
    expect(classifySymbolMarket('JPY=X', 'CURRENCY')).toBe('fx');
    expect(classifySymbolMarket('IDR=X')).toBe('fx');
    expect(classifySymbolMarket('GBP/JPY')).toBe('fx');
    // The dollar index is a macro instrument, not a tradeable pair.
    expect(classifySymbolMarket('DX-Y.NYB', 'CURRENCY')).toBe('macro');
  });

  it('falls back to symbol shape when quoteType is missing', () => {
    expect(classifySymbolMarket('BBCA.JK')).toBe('idx');
    expect(classifySymbolMarket('^JKSE')).toBe('index');
    expect(classifySymbolMarket('BTC-USD')).toBe('crypto');
    expect(classifySymbolMarket('BTC-USDT')).toBe('crypto');
    expect(classifySymbolMarket('GC=F')).toBe('macro');
    expect(classifySymbolMarket('EURUSD')).toBe('fx');
  });

  it('uses the exchange to separate IDX from US equities', () => {
    expect(classifySymbolMarket('BBRI', 'EQUITY', 'Jakarta')).toBe('idx');
    expect(classifySymbolMarket('AAPL', 'EQUITY', 'NasdaqGS')).toBe('us');
    expect(classifySymbolMarket('AAPL', 'EQUITY', undefined)).toBe('us');
  });

  it('does not mistake a dashed US ticker for a crypto pair', () => {
    // BRK-B and RDS-PD are real listings; only a known currency code means crypto.
    expect(classifySymbolMarket('BRK-B', 'EQUITY')).toBe('us');
    expect(classifySymbolMarket('RDS-PD', 'EQUITY')).toBe('us');
    expect(classifySymbolMarket('SOL-EUR')).toBe('crypto');
  });
});

describe('buildSymbolProbes', () => {
  it('leads with the curated alias for a known name', () => {
    expect(buildSymbolProbes('BTC')[0]).toBe('BTC-USD');
    expect(buildSymbolProbes('bitcoin')[0]).toBe('BTC-USD');
    expect(buildSymbolProbes('IHSG')[0]).toBe('^JKSE');
  });

  it('probes the IDX and crypto spellings of a bare code', () => {
    expect(buildSymbolProbes('BBCA')).toEqual(['BBCA.JK', 'BBCA', 'BBCA-USD']);
    expect(buildSymbolProbes('TLKM')).toContain('TLKM.JK');
  });

  it('probes an already-qualified symbol as-is', () => {
    expect(buildSymbolProbes('BBCA.JK')).toEqual(['BBCA.JK']);
    expect(buildSymbolProbes('^GSPC')).toEqual(['^GSPC']);
    expect(buildSymbolProbes('GC=F')).toEqual(['GC=F']);
  });

  it('probes only the canonical Yahoo symbol for a pair', () => {
    expect(buildSymbolProbes('EURUSD')).toEqual(['EURUSD=X', 'EURUSD']);
    expect(buildSymbolProbes('EUR/USD')[0]).toBe('EURUSD=X');
    expect(buildSymbolProbes('USDJPY')[0]).toBe('JPY=X');
    expect(buildSymbolProbes('IDR=X')).toEqual(['IDR=X']);
    // `.JK` / `-USD` guesses are meaningless for a pair and must not appear.
    expect(buildSymbolProbes('USDIDR')).toEqual(['IDR=X', 'USDIDR']);
  });

  it('never guesses for free text', () => {
    expect(buildSymbolProbes('bank central asia')).toEqual([]);
    expect(buildSymbolProbes('   ')).toEqual([]);
  });

  it('caps the probe count', () => {
    expect(buildSymbolProbes('NVDA').length).toBeLessThanOrEqual(4);
  });
});

describe('rankSymbolHits', () => {
  it('puts the exact literal symbol first', () => {
    const ranked = rankSymbolHits([
      hit({ symbol: 'BBRI.JK', name: 'Bank Rakyat Indonesia' }),
      hit({ symbol: 'BBCA.JK', name: 'Bank Central Asia' }),
    ], 'BBCA');

    expect(ranked[0].symbol).toBe('BBCA.JK');
  });

  it('merges duplicates instead of returning the same symbol twice', () => {
    const ranked = rankSymbolHits([
      hit({ symbol: 'BTC-USD', name: 'BTC-USD', source: 'boz', exchange: '' }),
      hit({ symbol: 'BTC-USD', name: 'Bitcoin USD', source: 'probe', exchange: 'CCC' }),
    ], 'btc');

    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe('Bitcoin USD');
    expect(ranked[0].source).toBe('probe');
  });

  it('prefers the richer name when sources disagree', () => {
    const ranked = rankSymbolHits([
      hit({ symbol: 'AAPL', name: 'Apple Inc.', source: 'yahoo' }),
      hit({ symbol: 'AAPL', name: 'AAPL', source: 'boz' }),
    ], 'AAPL');

    expect(ranked[0].name).toBe('Apple Inc.');
  });

  it('drops rows with no symbol and tolerates an empty query', () => {
    expect(rankSymbolHits([hit({ symbol: '' })], 'AAPL')).toEqual([]);
    expect(rankSymbolHits([hit({ symbol: 'AAPL' })], '')).toHaveLength(1);
  });
});

describe('filterHitsByMarket', () => {
  const hits = [
    hit({ symbol: 'AAPL', market: 'us' }),
    hit({ symbol: 'BBCA.JK', market: 'idx' }),
    hit({ symbol: 'BTC-USD', market: 'crypto' }),
  ];

  it('narrows to one market', () => {
    expect(filterHitsByMarket(hits, 'idx').map(h => h.symbol)).toEqual(['BBCA.JK']);
    expect(filterHitsByMarket(hits, 'crypto').map(h => h.symbol)).toEqual(['BTC-USD']);
  });

  it('passes everything through for all/other', () => {
    expect(filterHitsByMarket(hits, 'all')).toHaveLength(3);
  });
});

describe('paginateHits', () => {
  const hits = Array.from({ length: 23 }, (_, i) => hit({ symbol: `S${i}` }));

  it('returns a page plus the total and hasMore', () => {
    const page = paginateHits(hits, 8, 0);
    expect(page.results).toHaveLength(8);
    expect(page.total).toBe(23);
    expect(page.hasMore).toBe(true);
  });

  it('walks pages without overlapping or skipping', () => {
    const first = paginateHits(hits, 8, 0);
    const second = paginateHits(hits, 8, 8);
    const third = paginateHits(hits, 8, 16);

    expect(second.results[0].symbol).toBe('S8');
    expect(third.results).toHaveLength(7);
    expect(third.hasMore).toBe(false);
    expect(new Set([...first.results, ...second.results, ...third.results].map(h => h.symbol)).size).toBe(23);
  });

  it('survives an offset past the end', () => {
    const page = paginateHits(hits, 8, 999);
    expect(page.results).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});

describe('parameter guards', () => {
  it('clamps limit into range', () => {
    expect(clampSearchLimit(undefined)).toBe(8);
    expect(clampSearchLimit('abc')).toBe(8);
    expect(clampSearchLimit(0)).toBe(8);
    expect(clampSearchLimit(1000)).toBe(SYMBOL_SEARCH_MAX_LIMIT);
  });

  it('clamps offset to zero or more', () => {
    expect(clampSearchOffset(undefined)).toBe(0);
    expect(clampSearchOffset(-5)).toBe(0);
    expect(clampSearchOffset('12')).toBe(12);
  });

  it('rejects unknown market filters', () => {
    expect(parseSymbolMarketFilter('crypto')).toBe('crypto');
    expect(parseSymbolMarketFilter('nonsense')).toBe('all');
    expect(parseSymbolMarketFilter(null)).toBe('all');
  });

  it('trims and bounds the query', () => {
    expect(normalizeSymbolQuery('  bbc  ')).toBe('bbc');
    expect(normalizeSymbolQuery(null)).toBe('');
    expect(normalizeSymbolQuery('x'.repeat(500)).length).toBe(64);
  });
});