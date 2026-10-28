import { describe, expect, it } from 'vitest';
import { IdxScannerService, normalizeScannerUniverse } from '../src/services/market/idx.scanner.service.js';
import { FX_PAIRS, parseFxSymbol } from '../src/shared/fx.js';

describe('FX scanner universe', () => {
  it('normalises the forex universe and keeps the deprecated alias', () => {
    expect(normalizeScannerUniverse('forex')).toBe('forex');
    expect(normalizeScannerUniverse('global')).toBe('us');
    expect(normalizeScannerUniverse('crypto')).toBe('crypto');
    expect(normalizeScannerUniverse('nonsense')).toBe('idx');
  });

  it('returns the whole registry as canonical Yahoo pairs', async () => {
    const service = new IdxScannerService();
    const universe = await service.getUniverse('all', 'forex');
    expect(universe).toHaveLength(FX_PAIRS.length);
    for (const entry of universe) {
      expect(parseFxSymbol(entry.ticker)?.yahoo).toBe(entry.ticker);
    }
  });

  it('filters by pair class without network access', async () => {
    const service = new IdxScannerService();
    const majors = await service.getUniverse('major', 'forex');
    expect(majors).toHaveLength(FX_PAIRS.filter(pair => pair.class === 'major').length);
    expect(majors.every(entry => entry.sector === 'major')).toBe(true);

    const asia = await service.getUniverse('asia', 'forex');
    expect(asia.some(entry => entry.ticker === 'IDR=X')).toBe(true);
    expect(asia.every(entry => entry.sector === 'asia')).toBe(true);
  });
});
