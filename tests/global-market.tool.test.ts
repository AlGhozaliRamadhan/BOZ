import { describe, expect, it } from 'vitest';
import {
  GLOBAL_MARKET_SNAPSHOT_BUCKETS,
  fetchGlobalMarketSnapshotDefinition,
  isGlobalMarketOutlookRequest,
} from '../src/tools/global-market.tool';

describe('global market snapshot tool', () => {
  it('covers regional equities, rates and credit, and macro risk signals', () => {
    expect(GLOBAL_MARKET_SNAPSHOT_BUCKETS).toEqual([
      { label: 'Equities', symbols: ['SPY', 'QQQ', 'ACWI', 'EFA', 'EEM'] },
      { label: 'Rates and credit', symbols: ['IEF', 'TLT', 'BNDX', 'HYG', 'EMB'] },
      { label: 'Macro risk signals', symbols: ['^VIX', '^TNX', 'UUP', 'GC=F', 'CL=F'] },
    ]);
    expect(fetchGlobalMarketSnapshotDefinition.function.name).toBe('fetch_global_market_snapshot');
  });

  it('recognizes a global equities, bonds, and macro outlook request', () => {
    expect(isGlobalMarketOutlookRequest(
      'What is the current global market outlook across equities, bonds, and macro regimes?',
    )).toBe(true);
    expect(isGlobalMarketOutlookRequest('Analyze SPY technical levels')).toBe(false);
  });
});
