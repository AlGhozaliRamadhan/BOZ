import { describe, expect, it } from 'vitest';
import { classifyHeadline, headlineToneCounts } from '../src/shared/news-sentiment.js';

describe('headline sentiment classifier', () => {
  it('reads bullish earnings/momentum headlines as bullish', () => {
    const bullish = [
      'Nvidia beats expectations as data center sales surge',
      'Tesla soars after record deliveries',
      'Indonesian bank logs profit jump on strong lending growth',
      'Shares climb after company raises full-year guidance',
      'Apple tops Q1 estimates on strong demand',
      'Stock rallies to an all-time high',
      'Bank upgraded to Buy rating on improved margin',
      'Company wins Jakarta toll road contract',
      'Buyback announced as profit doubles',
    ];
    for (const title of bullish) expect(classifyHeadline(title)).toBe('bullish');
  });

  it('reads downside headlines as bearish', () => {
    const bearish = [
      'Nvidia plunges as data center orders fall short',
      'Tesla slides after missing delivery estimates',
      'Profit falls amid weak demand',
      'Shares skid 8% as company cuts full-year guidance',
      'Regulator opens probe into lending practices',
      'Bondholders brace for default risk',
      'Chipmaker downgraded to Sell as slowdown deepens',
      'Investors sue board over accounting',
    ];
    for (const title of bearish) expect(classifyHeadline(title)).toBe('bearish');
  });

  it('refuses to pick a side on mixed or unhinted headlines', () => {
    expect(classifyHeadline('Shares fall as profit jumps 12%')).toBe('neutral'); // row-cancel
    expect(classifyHeadline('Alphabet announces leadership transition')).toBe('neutral');
    expect(classifyHeadline('Fed meeting minutes released')).toBe('neutral');
    expect(classifyHeadline('Central bank holds rates steady, regulator clarifies guidance wording')).toBe('neutral');
    expect(classifyHeadline('')).toBe('neutral');
    expect(classifyHeadline('   ')).toBe('neutral');
  });

  it('never sees inside-word matches (boundaries matter)', () => {
    // "offbeat", "missile", "briefing" must not hit beat/miss/fall.
    expect(classifyHeadline('The offbeat missive briefs nothing')).toBe('neutral');
  });

  it('does its deciding from lowercased text', () => {
    expect(classifyHeadline('IBM SOARS ON RECORD EARNINGS')).toBe('bullish');
    expect(classifyHeadline('TESLA PLUNGES AFTER WARNINGS')).toBe('bearish');
  });

  it('counts tones across a whole day for the tile tint', () => {
    expect(headlineToneCounts([
      { sentiment: 'bullish' },
      { sentiment: 'bullish' },
      { sentiment: 'bearish' },
      { sentiment: 'neutral' },
    ])).toEqual({ bullish: 2, bearish: 1 });
    expect(headlineToneCounts([{ sentiment: 'neutral' }])).toEqual({ bullish: 0, bearish: 0 });
    expect(headlineToneCounts([])).toEqual({ bullish: 0, bearish: 0 });
  });
});
