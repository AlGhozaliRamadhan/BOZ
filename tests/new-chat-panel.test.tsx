import { describe, expect, it } from 'vitest';
import { LAST_TICKER_STORAGE_KEY } from '@/app/chat/NewChatPanel';
import { fakeStorage } from './helpers';

function tickerPlaceholder(storage: { getItem(key: string): string | null }): string {
  return storage.getItem(LAST_TICKER_STORAGE_KEY) || 'NVDA';
}

function analysisCommand(kind: 'intraday' | 'longterm' | 'newsintel', ticker: string): string {
  if (kind === 'newsintel') return '/newsintel';
  const sym = ticker.trim().toUpperCase() || 'NVDA';
  return `/${kind} ${sym}`;
}

describe('NewChatPanel ticker handoff', () => {
  it('falls back to NVDA when no ticker was stored', () => {
    expect(tickerPlaceholder(fakeStorage())).toBe('NVDA');
  });

  it('reuses the last ticker for intraday and long-term quick actions', () => {
    const storage = fakeStorage({ [LAST_TICKER_STORAGE_KEY]: 'bbca.jk' });
    const stored = tickerPlaceholder(storage);

    expect(analysisCommand('intraday', stored)).toBe('/intraday BBCA.JK');
    expect(analysisCommand('longterm', stored)).toBe('/longterm BBCA.JK');
    expect(analysisCommand('newsintel', stored)).toBe('/newsintel');
  });
});
