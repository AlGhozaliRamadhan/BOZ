import { describe, expect, it } from 'vitest';
import { requiredTickerResearchQueries } from '../src/shared/ticker-research.js';

describe('required ticker research', () => {
  it('uses one catalyst query at low effort', () => {
    expect(requiredTickerResearchQueries('nvda', 'Low')).toEqual([
      'NVDA latest earnings guidance company catalysts',
    ]);
  });

  it('uses complementary catalyst and risk queries at higher effort', () => {
    expect(requiredTickerResearchQueries('NVDA', 'Max')).toEqual([
      'NVDA latest earnings guidance company catalysts',
      'NVDA regulation sector competitor macro risks',
    ]);
  });
});
