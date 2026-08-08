import { describe, it, expect } from 'vitest';
import { InteractiveChatAgent } from '../src/agents/chat.agent.js';

// extractFact is a private method — we test it through a typed cast. It is a
// pure function: (toolName, args, obs) -> LedgerEntry | null. It sits on the
// correctness-critical path: the TOOL-VERIFIED / ILLUSTRATIVE split in the
// review passes and the reasoning agent both read the ledger it produces. If
// web_search extracts headline-only text, the model classifies against a
// skeleton instead of real figures — which is exactly the "self-attesting"
// failure mode we are guarding against. These tests pin the real shapes.

function extractFact(toolName: string, args: Record<string, any>, obs: string): any {
  const agent = new InteractiveChatAgent();
  return (agent as any).extractFact(toolName, args, obs);
}

describe('extractFact — web_search', () => {
  it('extracts the actual RAG figures across multiple sources (deepSearch shape)', () => {
    const obs = [
      'Web search results for "foreign ownership IDX":',
      '- Foreign investors own 38% of IDX: ...',
      '',
      'Deep web research for "foreign ownership IDX" (2 sources analyzed):',
      '',
      '## Foreign Ownership of Indonesian Stocks Hits Record',
      'Source: https://example.com/foreign-ownership',
      'Foreign investors hold 38.2% of the IDX market cap, up from 35% a year ago. Retail participation reached 22%.',
      '',
      '## BI Holds Benchmark Rate',
      'Source: https://example.com/bi-rate',
      'Bank Indonesia kept the 7-day repo rate at 5.75%, citing stable rupiah at 16,150/USD.',
    ].join('\n');

    const fact = extractFact('web_search', { query: 'foreign ownership IDX' }, obs);
    expect(fact).not.toBeNull();
    expect(fact.quality).toBe('confirmed');
    expect(fact.fact).toContain('38.2%');
    expect(fact.fact).toContain('Retail participation reached 22%');
    expect(fact.fact).toContain('5.75%');
    // Both sources are present, and the URL must NOT leak into the fact.
    expect(fact.fact).toContain('BI Holds Benchmark Rate');
    expect(fact.fact).not.toContain('example.com');
  });

  it('falls back to the headline when the tool returned only search results (no RAG)', () => {
    const obs = [
      'Web search results for "foreign ownership IDX":',
      '- Foreign investors own 38% of IDX: ...',
      '- Bank Indonesia holds rate at 5.75%: ...',
    ].join('\n');

    const fact = extractFact('web_search', { query: 'foreign ownership IDX' }, obs);
    expect(fact).not.toBeNull();
    expect(fact.quality).toBe('confirmed');
    expect(fact.fact).toContain('2 results');
    expect(fact.fact).toContain('Foreign investors own 38%');
  });

  it('handles a source with no clean "Source: <url>" line', () => {
    const obs = [
      'Web search results for "IDX foreign ownership":',
      '- Foreign investors own 38% of IDX: ...',
      '',
      'Deep web research for "IDX foreign ownership" (1 sources analyzed):',
      '',
      '## Quarterly IDX Ownership Report',
      'Foreign holdings declined to 34.1% this quarter from 35.8% last quarter.',
    ].join('\n');

    const fact = extractFact('web_search', { query: 'IDX foreign ownership' }, obs);
    expect(fact).not.toBeNull();
    // The missing Source: line must not swallow the body — the figures survive.
    expect(fact.fact).toContain('34.1%');
    expect(fact.fact).not.toContain('Source:');
  });

  it('marks empty search results as quality=empty', () => {
    const obs = 'Web search for "zzz unknown ticker" returned no results across all search providers.';
    const fact = extractFact('web_search', { query: 'zzz unknown ticker' }, obs);
    expect(fact).not.toBeNull();
    expect(fact.quality).toBe('empty');
  });
});
