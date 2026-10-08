import { describe, expect, it } from 'vitest';
import { formatCrowdSignalEvidence } from '../src/shared/evidence-attribution.js';

describe('crowd-signal attribution', () => {
  it('states the source, sample, and non-predictive limitation', () => {
    const result = formatCrowdSignalEvidence({
      fear_greed: {
        value: 42,
        label: 'Fear',
        source: 'CNN Fear & Greed',
        source_url: 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      },
      stocktwits_data: {
        bull_ratio: 62.5,
        bullish: 5,
        bearish: 3,
        total_with_sentiment: 8,
        total_messages: 30,
        source: 'StockTwits',
        source_url: 'https://api.stocktwits.com/api/2/streams/symbol/NVDA.json',
      },
    });

    expect(result).toContain('Crowd signal (not a forecast)');
    // API/data endpoints are named inline, never rendered as source links:
    // linkifying them teaches the model to paste endpoint URLs as citations.
    expect(result).toContain('CNN Fear & Greed');
    expect(result).not.toContain('production.dataviz.cnn.io');
    expect(result).toContain('StockTwits');
    expect(result).not.toContain('api.stocktwits.com');
    expect(result).toContain('8 labelled messages out of 30 sampled');
  });

  it('still linkifies genuine publisher URLs', () => {
    const result = formatCrowdSignalEvidence({
      social_buzz: [
        {
          source: 'Reddit',
          mentions: 12,
          window: '30d',
          source_url: 'https://www.reddit.com/r/stocks/comments/abc123/nvda_discussion/',
        },
      ],
    });
    expect(result).toContain('[Reddit](https://www.reddit.com/r/stocks/comments/abc123/nvda_discussion/)');
  });

  it('does not manufacture a source when no crowd data exists', () => {
    expect(formatCrowdSignalEvidence({})).toBe('');
  });
});
