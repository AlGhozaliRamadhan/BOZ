import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeFetchPrice } from '../src/tools/ticker.tool';
import { yahooFinance } from '../src/services/market/yahoo.service';
import { projectToolEvidence } from '../src/shared/chat-evidence';

afterEach(() => vi.restoreAllMocks());
const call = { name: 'fetch_price', arguments: { symbol_or_name: 'NVDA' } };

describe('price tool availability', () => {
  it('preserves a real zero change without inventing one for a missing quote field', async () => {
    const quote = vi.spyOn(yahooFinance, 'quote').mockResolvedValue({ regularMarketPrice: 100, regularMarketChangePercent: 0 } as any);
    expect(await executeFetchPrice('NVDA')).toContain('Change: 0.00%');
    quote.mockResolvedValue({ regularMarketPrice: 100 } as any);
    const raw = await executeFetchPrice('NVDA');
    const observation = projectToolEvidence(call, raw);
    expect(observation.data).toContain('Price: 100');
    expect(observation.data).not.toContain('Change');
    expect(observation.unavailable).toEqual(['Change']);
  });

  it('keeps transient failures eligible for recovery without mislabeling the ticker', async () => {
    vi.spyOn(yahooFinance, 'quote').mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const search = vi.spyOn(yahooFinance, 'search');
    const raw = await executeFetchPrice('NVDA');
    expect(raw).toContain('timed out');
    expect(projectToolEvidence(call, raw).clarification).toBe(false);
    expect(projectToolEvidence(call, raw).data).toBe('');
    expect(search).not.toHaveBeenCalled();
  });

  it('retains clarification for an unavailable ticker and excludes it from market evidence', async () => {
    vi.spyOn(yahooFinance, 'quote').mockResolvedValue({} as any);
    vi.spyOn(yahooFinance, 'search').mockResolvedValue({ quotes: [] } as any);
    const observation = projectToolEvidence(call, await executeFetchPrice('NVDA'));
    expect(observation.clarification).toBe(true);
    expect(observation.data).toBe('');
  });
});
