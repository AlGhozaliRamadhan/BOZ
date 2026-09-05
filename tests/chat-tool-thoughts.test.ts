import { describe, expect, it } from 'vitest';
import { toolStartThought, updateToolResultThought } from '../src/app/chat/tool-thoughts';

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
});
