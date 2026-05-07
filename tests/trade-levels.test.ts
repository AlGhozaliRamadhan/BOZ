import { describe, it, expect } from 'vitest';
import { buildTradeLevels } from '../src/shared/trade-levels.js';

describe('buildTradeLevels', () => {
  it('calculates ranges for a BUY with high confidence', () => {
    const levels = buildTradeLevels(100, 'BUY', 75, 'neutral');

    expect(levels.action).toBe('BUY');
    expect(levels.entryRange).toBe('from 99.400 to 100.600');
    expect(levels.targetRange).toBe('from 103.500 to 108.000');
    expect(levels.stopLoss).toBe('97.000');
  });

  it('overrides to WATCH on late signals', () => {
    const levels = buildTradeLevels(100, 'BUY', 75, 'record high momentum');

    expect(levels.action).toBe('WATCH');
    expect(levels.lateSignal.startsWith('YES')).toBe(true);
  });
});
