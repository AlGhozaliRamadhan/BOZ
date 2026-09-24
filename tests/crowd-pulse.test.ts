import { describe, expect, it } from 'vitest';
import { buildStocktwitsPulse, stocktwitsContrarianNote } from '../src/shared/crowd-pulse.js';

describe('stocktwits pulse', () => {
  it('audits the claimed bull ratio against countable messages', () => {
    const pulse = buildStocktwitsPulse({ bullish: 6, bearish: 2, total_with_sentiment: 8, bull_ratio: 99 });

    expect(pulse.bullRatio).toBeCloseTo(75, 5);
    expect(pulse.bearRatio).toBeCloseTo(25, 5);
    expect(pulse.confidence).toBe('MODERATE');
  });

  it('falls back to the claimed ratio only when no counts exist', () => {
    const pulse = buildStocktwitsPulse({ bull_ratio: 62.5 });

    expect(pulse.bullRatio).toBe(62.5);
    expect(pulse.labelled).toBe(0);
    expect(pulse.confidence).toBe('EMPTY');
  });

  it('tiers confidence by labelled sample size', () => {
    expect(buildStocktwitsPulse({ bullish: 15, bearish: 10, total_with_sentiment: 25 }).confidence).toBe('STRONG');
    expect(buildStocktwitsPulse({ bullish: 3, bearish: 1, total_with_sentiment: 4 }).confidence).toBe('THIN');
    expect(buildStocktwitsPulse(null).confidence).toBe('EMPTY');
  });

  it('measures the unlabelled share of the sampled stream', () => {
    const pulse = buildStocktwitsPulse({ bullish: 5, bearish: 3, total_with_sentiment: 8, total_messages: 30 });

    expect(pulse.neutralShare).toBeCloseTo((22 / 30) * 100, 5);
  });

  it('refuses a contrarian read on a thin sample', () => {
    const note = stocktwitsContrarianNote(
      buildStocktwitsPulse({ bullish: 2, bearish: 0, total_with_sentiment: 2, total_messages: 10 }),
    );

    expect(note).toContain('too thin');
  });

  it('flags euphoria and fear only on usable samples', () => {
    const euphoric = stocktwitsContrarianNote(
      buildStocktwitsPulse({ bullish: 18, bearish: 2, total_with_sentiment: 20, total_messages: 30 }),
    );
    const fearful = stocktwitsContrarianNote(
      buildStocktwitsPulse({ bullish: 2, bearish: 18, total_with_sentiment: 20, total_messages: 30 }),
    );

    expect(euphoric).toContain('euphoria');
    expect(fearful).toContain('fear');
  });
});
