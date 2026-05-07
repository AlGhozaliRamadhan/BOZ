import { describe, it, expect } from 'vitest';
import { resolveSymbol } from '../src/shared/market-constants.js';

describe('resolveSymbol', () => {
  it('resolves aliases and passthrough symbols', () => {
    expect(resolveSymbol('BITCOIN')).toBe('BTC-USD');
    expect(resolveSymbol('MSFT')).toBe('MSFT');
    expect(resolveSymbol('SOL-USD')).toBe('SOL-USD');
  });

  it('returns null for unknown inputs', () => {
    expect(resolveSymbol('$$$')).toBeNull();
  });
});
