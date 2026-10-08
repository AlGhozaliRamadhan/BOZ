import { describe, expect, it } from 'vitest';
import {
  appendAiReadThought,
  buildAiRead,
  buildTrackLine,
  isAiReadThought,
  isTrackThought,
  toolStartThought,
  updateToolResultThought,
} from '../src/app/chat/_lib/tool-thoughts';

describe('streamed tool thoughts', () => {
  it('updates the matching ticker result without replacing another fetch_price call', () => {
    const started = [
      toolStartThought('fetch_price', { symbol_or_name: 'SPY' }),
      toolStartThought('fetch_price', { symbol_or_name: 'ACWI' }),
    ];

    const afterSpy = updateToolResultThought(started, {
      tool: 'fetch_price',
      args: { symbol_or_name: 'SPY' },
      fact: 'SPY: price 600, change 1.2%',
    });
    const afterAcwi = updateToolResultThought(afterSpy, {
      tool: 'fetch_price',
      args: { symbol_or_name: 'ACWI' },
      fact: 'ACWI: price 120, change 0.4%',
    });

    expect(afterAcwi).toEqual([
      'tool used: fetch_price (SPY) — SPY: price 600, change 1.2%',
      'tool used: fetch_price (ACWI) — ACWI: price 120, change 0.4%',
    ]);
  });

  it('builds a short raw read grounded in the fact — no canned prefix, no invented levels', () => {
    const read = buildAiRead('fetch_ticker_dashboard', 'NVDA: Price: $240, Bias: Bullish (Score: strong)');
    expect(read.startsWith('I see:')).toBe(false);
    expect(read).not.toContain('Next:');
    expect(read.length).toBeLessThanOrEqual(180);
    // Grounded: echoes the fact's own level instead of inventing one.
    expect(read).toContain('240');
  });

  it('goes longer on rich facts: take plus grounded specifics, still capped', () => {
    const rich = buildAiRead(
      'fetch_ticker_dashboard',
      'NVDA: Price: $237.47, Bias: Bullish intraday uptrend (Score: strong +81). Plan: buy (Entry: $226.50, Stop: $218.94, T1: $243.37) | ATR: $5.61 (2.36%), RSI: 64.3, Support: $218.94, Resistance: $243.37, Regime: golden-cross with price above SMA-20 at $225.58 and heavy call-flow volume at 0.75x average with OBV distribution noted',
    );
    expect(rich).toContain('Keeping an eye on');
    expect(rich).toContain('SMA-20');
    expect(rich).toContain('RSI 64.3');
    expect(rich.length).toBeLessThanOrEqual(420);
    // Thin facts stay a single quick line.
    const thin = buildAiRead('fetch_price', 'SPY: price 600, change 1.2%');
    expect(thin.length).toBeLessThanOrEqual(180);
  });

  it('reads sample size on sentiment and flags on failing risk_calc', () => {
    const sent = buildAiRead('fetch_sentiment', 'Sentiment: Fear & Greed 82 (Extreme Greed), StockTwits 78% bullish of 8 labelled');
    expect(sent).toContain('8 labelled');
    const flagged = buildAiRead('risk_calc', 'risk_calc NVDA long: stop_distance 48.51, R:R [0.16] warnings: RR below 1.5');
    expect(flagged).toContain('Flag on it');
  });

  it('reads a failing risk_calc as thin/reject, a passing one as tradable — echoing its numbers', () => {
    const failing = buildAiRead('risk_calc', 'risk_calc NVDA long: stop_distance 48.51, R:R [0.16] warnings: RR below 1.5');
    expect(failing).toMatch(/thin|waiting|hope|shelving|chops/i);
    expect(failing).toContain('0.16');
    const passing = buildAiRead('risk_calc', 'risk_calc NVDA long: stop_distance 7.56, R:R [2.23, 2.84]');
    expect(passing).toMatch(/tradable|carry|live|works/i);
    expect(passing).toContain('2.23');
  });

  it('varies phrasing across different facts instead of repeating one template', () => {
    const reads = new Set([
      buildAiRead('fetch_ticker_dashboard', 'NVDA: Price: $240, Bias: Bullish (Score: strong)'),
      buildAiRead('fetch_ticker_dashboard', 'NVDA: Price: $180, Bias: Bearish, RSI: 28'),
      buildAiRead('web_search', 'Web search "NVDA chips": 3 results. TSMC raises capex outlook'),
      buildAiRead('fetch_sentiment', 'Sentiment: Fear & Greed 82 (Extreme Greed), StockTwits 78% bullish'),
      buildAiRead('risk_calc', 'risk_calc NVDA long: stop_distance 48.51, R:R [0.16] warnings: RR below 1.5'),
    ]);
    // Same template every time would collapse this to 1–2 strings.
    expect(reads.size).toBeGreaterThanOrEqual(4);
    for (const read of reads) {
      expect(read.startsWith('I see:')).toBe(false);
      expect(isAiReadThought(read)).toBe(true);
    }
  });

  it('appends AI reads after tool results and drops a track line every third read', () => {
    let thoughts: string[] = [];
    thoughts = appendAiReadThought(thoughts, { tool: 'fetch_ticker_dashboard', fact: 'NVDA bullish at $240' });
    thoughts = appendAiReadThought(thoughts, { tool: 'web_search', fact: '2 results' });
    expect(thoughts.filter(isAiReadThought)).toHaveLength(2);
    thoughts = appendAiReadThought(thoughts, { tool: 'risk_calc', fact: 'R:R [2.23]' });
    expect(thoughts.filter(isAiReadThought)).toHaveLength(3);
    expect(thoughts.some(isTrackThought)).toBe(true);
    expect(buildTrackLine(2, 'scenario')).toContain('Track 2/5');
  });
});
