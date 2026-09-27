import { describe, expect, it } from 'vitest';
import { ChatEvidence, compactEvidenceText, evidenceKey, projectToolEvidence } from '../src/shared/chat-evidence';

describe('compact chat evidence', () => {
  it('keeps useful fields, zero values and sources while dropping placeholders and empty headings', () => {
    const result = compactEvidenceText('=== PRICE ===\nPrice: 100 | Change: 0% | P/E: N/A\nVolume: 0\nSource: https://example.com\n=== EMPTY ===\nATR: --\n=== LEVELS ===\nBands (Upper: 110, Mid: --, Lower: 90)');
    expect(result.data).toContain('Price: 100 | Change: 0%');
    expect(result.data).toContain('Volume: 0');
    expect(result.data).toContain('https://example.com');
    expect(result.data).toContain('Upper: 110, Lower: 90');
    expect(result.data).not.toMatch(/N\/A|--|EMPTY/);
    expect(result.unavailable).toEqual(expect.arrayContaining(['P/E', 'ATR', 'Mid']));
  });

  it('filters missing JSON recursively without treating zero, false, or empty result sets as null', () => {
    const result = compactEvidenceText('{"price":100,"change":0,"active":false,"matches":[],"sentiment":null,"bands":{"upper":110,"lower":null}}');
    expect(JSON.parse(result.data)).toEqual({ price: 100, change: 0, active: false, matches: [], bands: { upper: 110 } });
    expect(result.unavailable).toEqual(['sentiment', 'bands.lower']);
    expect(projectToolEvidence({ name: 'fetch_sentiment', arguments: {} }, '{"fear_greed":null,"overall_signals":[]}').data).toBe('');
  });

  it('removes an empty timeframe heading while preserving the next usable timeframe', () => {
    const result = compactEvidenceText('=== TECHNICALS ===\n[Hourly]:\nHourly candles unavailable\n[Daily]:\nPrice: 100');
    expect(result.data).toBe('=== TECHNICALS ===\n[Daily]:\nPrice: 100');
  });

  it('does not strip qualifiers or unavailable words out of external articles', () => {
    const raw = '- [Source] Exports unavailable after the closure; production remains 0.';
    expect(projectToolEvidence({ name: 'web_search', arguments: { query: 'exports' } }, raw).data).toBe(raw);
  });

  it('recognizes exhausted source cascades and ticker clarification', () => {
    const book = new ChatEvidence();
    for (const [name, raw] of [
      ['fetch_news', 'No news found for "NVDA".'],
      ['web_search', 'Web search for "NVDA" returned no results across all search providers.'],
      ['fetch_price', 'Could not find ticker "???". Please ask user to verify the symbol.'],
    ]) {
      const item = book.record(projectToolEvidence({ name, arguments: {} }, raw));
      expect(book.claimRecovery(item)).toBe(false);
      expect(item.data).toBe('');
    }
  });

  it('allows only one recovery and removes a resolved failure from the narrative', () => {
    const book = new ChatEvidence();
    const call = { name: 'fetch_price', arguments: { symbol_or_name: 'NVDA' } };
    const first = book.record(projectToolEvidence(call, 'Tool execution failed: timeout'));
    expect(book.claimRecovery(first)).toBe(true);
    const second = book.record(projectToolEvidence(call, 'Price: 100 | Change: 0%'));
    expect(book.claimRecovery(second)).toBe(false);
    expect(book.availability()).toBe('');
    expect(book.failureSummary()).toBe('');
    expect(book.data()).toContain('Price: 100');
    expect(book.get({ name: call.name, arguments: { symbol_or_name: ' nvda ' } })).toBe(second);
  });

  it('preserves useful initial data if recovery fails completely', () => {
    const book = new ChatEvidence();
    const call = { name: 'fetch_ticker_dashboard', arguments: { symbol: 'NVDA' } };
    const first = book.record(projectToolEvidence(call, 'Price: 100 | P/E: N/A'));
    book.claimRecovery(first);
    const last = book.record(projectToolEvidence(call, 'Tool execution failed: timeout'));
    expect(last.data).toContain('Price: 100');
    expect(last.unavailable).toEqual(['P/E']);
    expect(book.failureSummary()).toContain('remains partial');
    expect(book.availability()).toContain('recovery exhausted');
    expect(book.claimRecovery(last)).toBe(false);
  });

  it('canonicalizes argument ordering and query whitespace', () => {
    expect(evidenceKey({ name: 'web_search', arguments: { query: ' NVDA  News ', depth: 2 } }))
      .toBe(evidenceKey({ name: 'web_search', arguments: { depth: 2, query: 'nvda news' } }));
  });
});
