import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { idxScannerService, normalizeScannerUniverse } from '@/services/market/idx.scanner.service';
import type { ScannerUniverse, SignalFilter, SetupFilter, ScanMode } from '@/services/market/idx.scanner.service';
import { WorkloadBusyError } from '@/services/security/workload-gate';
import { log } from '@/utils/logger';

const VALID_IDX_SECTORS = [
  'all', 'banking', 'consumer', 'mining', 'energy',
  'tech', 'property', 'telecom', 'healthcare', 'industrial',
];
const VALID_US_SECTORS = [
  'all', 'technology', 'finance', 'healthcare', 'energy',
  'consumer', 'industrial',
];
const VALID_CRYPTO_SECTORS = ['all'];
const VALID_UNIVERSES: ScannerUniverse[] = ['idx', 'us', 'crypto', 'global'];
const VALID_SIGNALS: SignalFilter[] = ['buy', 'sell', 'any'];
const VALID_SETUPS: SetupFilter[] = ['momentum', 'rebound', 'near_52w_low', 'all_time_low', 'downtrend', 'breakout', 'oversold'];
const VALID_MODES: ScanMode[] = ['fast', 'deep'];
const VALID_CONVICTIONS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const universe = (params.get('universe') ?? 'idx') as ScannerUniverse;
    const sector = params.get('sector') ?? 'all';
    const signal = (params.get('direction') ?? params.get('signal') ?? 'buy') as SignalFilter;
    const setup = (params.get('preset') ?? params.get('setup') ?? 'momentum') as SetupFilter;
    const mode = (params.get('mode') ?? 'fast') as ScanMode;
    const minimumConviction = (params.get('minimumConviction') ?? 'LOW').toUpperCase() as typeof VALID_CONVICTIONS[number];

    if (!VALID_UNIVERSES.includes(universe)) {
      return errorResponse(`Invalid universe. Valid: ${VALID_UNIVERSES.join(', ')}`, 400);
    }
    const normalizedUniverse = normalizeScannerUniverse(universe);
    const validSectors = normalizedUniverse === 'crypto'
      ? VALID_CRYPTO_SECTORS
      : normalizedUniverse === 'us'
        ? VALID_US_SECTORS
        : VALID_IDX_SECTORS;
    if (!validSectors.includes(sector)) {
      return errorResponse(`Invalid sector. Valid: ${validSectors.join(', ')}`, 400);
    }
    if (!VALID_SIGNALS.includes(signal)) {
      return errorResponse(`Invalid signal. Valid: ${VALID_SIGNALS.join(', ')}`, 400);
    }
    if (!VALID_SETUPS.includes(setup)) {
      return errorResponse(`Invalid setup. Valid: ${VALID_SETUPS.join(', ')}`, 400);
    }
    if (!VALID_MODES.includes(mode)) {
      return errorResponse(`Invalid mode. Valid: ${VALID_MODES.join(', ')}`, 400);
    }
    if (!VALID_CONVICTIONS.includes(minimumConviction)) {
      return errorResponse(`Invalid minimumConviction. Valid: ${VALID_CONVICTIONS.join(', ')}`, 400);
    }

    const result = await idxScannerService.scan(sector, signal, setup, mode, {
      minimumConviction,
      signal: request.signal,
      universe,
    });

    return jsonResponse({
      schemaVersion: 1,
      timestamp: result.completedAt,
      query: {
        sector: result.sector,
        preset: result.preset,
        direction: result.signalFilter,
        mode: result.mode,
        minimumConviction,
        universe: result.universe,
      },
      meta: {
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        universeCount: result.universeCount,
        candidateCount: result.candidateCount,
        enrichedCount: result.totalScanned,
        skippedCount: result.skipped.length,
        partial: result.partial,
        cacheHit: result.cacheHit,
      },
      summary: {
        bullish: result.bullishCount,
        bearish: result.bearishCount,
        neutral: result.neutralCount,
        buyCount: result.buyCount,
        sellCount: result.sellCount,
        watchCount: result.watchCount,
        avoidCount: result.avoidCount,
        averageScore: result.avgScore,
        avgScore: result.avgScore,
        breadthSignal: result.breadthSignal,
      },
      results: result.results,

      // Compatibility fields for clients using the pre-v1 scanner response.
      sector: result.sector,
      mode: result.mode,
      universeCount: result.universeCount,
      candidateCount: result.candidateCount,
      totalScanned: result.totalScanned,
      buys: result.buys,
      watches: result.watches,
      avoids: result.avoids,
      skippedCount: result.skipped.length,
    });
  } catch (err: unknown) {
    if (err instanceof WorkloadBusyError) return errorResponse(err.message, 429);
    if (request.signal.aborted) return errorResponse('Scan cancelled', 499);
    log.error('idx-scan', err instanceof Error ? err.message : 'Unknown scanner error');
    const paramsUniverse = request.nextUrl.searchParams.get('universe') ?? 'idx';
    const normalized = normalizeScannerUniverse(paramsUniverse);
    const scanLabel = normalized === 'crypto' ? 'Crypto scan failed. Please try again.'
      : normalized === 'us' ? 'US scan failed. Please try again.'
      : 'IDX scan failed. Please try again.';
    return errorResponse(scanLabel);
  }
}


