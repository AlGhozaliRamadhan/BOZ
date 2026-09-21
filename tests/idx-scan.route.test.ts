import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/idx/scan/route.js';
import { idxScannerService } from '../src/services/market/idx.scanner.service.js';

function scanResult() {
  return {
    sector: 'banking',
    preset: 'breakout',
    signalFilter: 'any',
    mode: 'fast',
    startedAt: '2026-09-20T00:00:00.000Z',
    completedAt: '2026-09-20T00:00:01.000Z',
    universeCount: 100,
    candidateCount: 60,
    totalScanned: 58,
    buyCount: 4,
    sellCount: 2,
    watchCount: 52,
    avoidCount: 2,
    bullishCount: 20,
    bearishCount: 12,
    neutralCount: 26,
    avgScore: 14.5,
    breadthSignal: 'SELECTIVE MOMENTUM — rotate carefully',
    partial: true,
    cacheHit: false,
    results: [],
    buys: [],
    watches: [],
    avoids: [],
    skipped: ['MISS.JK'],
    formatted: 'formatted',
  } as const;
}

afterEach(() => vi.restoreAllMocks());

describe('IDX scan route', () => {
  it('rejects unknown presets before starting a scan', async () => {
    const spy = vi.spyOn(idxScannerService, 'scan');
    const response = await GET(new NextRequest('http://localhost/api/idx/scan?preset=magic'));

    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the canonical response and compatibility groups', async () => {
    vi.spyOn(idxScannerService, 'scan').mockResolvedValue(scanResult() as any);
    const request = new NextRequest('http://localhost/api/idx/scan?preset=breakout&sector=banking&direction=any&minimumConviction=medium');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.schemaVersion).toBe(1);
    expect(json.query).toEqual({
      sector: 'banking',
      preset: 'breakout',
      direction: 'any',
      mode: 'fast',
      minimumConviction: 'MEDIUM',
    });
    expect(json.meta).toMatchObject({ enrichedCount: 58, partial: true, skippedCount: 1 });
    expect(json.summary).toMatchObject({ bullish: 20, sellCount: 2, avoidCount: 2, averageScore: 14.5 });
    expect(json.buys).toEqual([]);
  });

  it('does not expose internal scanner errors', async () => {
    vi.spyOn(idxScannerService, 'scan').mockRejectedValue(new Error('provider secret detail'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await GET(new NextRequest('http://localhost/api/idx/scan'));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe('IDX scan failed. Please try again.');
    expect(JSON.stringify(json)).not.toContain('provider secret detail');
  });
});
