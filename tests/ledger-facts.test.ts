import { describe, it, expect } from 'vitest';
import { formatLedgerFacts } from '../src/shared/ledger-facts.js';

// The ledger is append-only, so two sources can disagree about the same
// quantity and BOTH survive. The whole point of the Extra "cross-check against
// 2+ sources" tier is that the review pass sees both values and weighs them —
// not a single flattened number it rubber-stamps. These tests pin that the
// renderer surfaces the rivalry explicitly.

describe('formatLedgerFacts', () => {
  it('keeps both disagreeing values and flags the disagreement', () => {
    const out = formatLedgerFacts([
      { fact: '[Reuters] Foreign ownership of IDX: 38.2% of market cap', quality: 'confirmed' },
      { fact: '[BI survey] Foreign ownership of IDX: 34.1% of market cap', quality: 'confirmed' },
    ]);

    expect(out).toContain('38.2%');
    expect(out).toContain('34.1%');
    expect(out).toContain('DISAGREES with the above');
  });

  it('lists non-overlapping quantitative facts without a false disagreement flag', () => {
    const out = formatLedgerFacts([
      { fact: '[Reuters] Foreign ownership of IDX: 38.2% of market cap', quality: 'confirmed' },
      { fact: '[BI] 7-day repo rate: 5.75%', quality: 'confirmed' },
    ]);

    expect(out).toContain('38.2%');
    expect(out).toContain('5.75%');
    expect(out).not.toContain('DISAGREES');
  });

  it('marks empty results as gaps', () => {
    const out = formatLedgerFacts([
      { fact: '[Reuters] Foreign ownership of IDX: 38.2% of market cap', quality: 'confirmed' },
      { fact: 'News for "XYZ": no relevant headlines', quality: 'empty' },
    ]);

    expect(out).toContain('38.2%');
    expect(out).toContain('GAPS / EMPTY RESULTS');
    expect(out).toContain('no relevant headlines');
  });
});
