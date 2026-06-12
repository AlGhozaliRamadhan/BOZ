import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { IdxScannerService } from '@/services/market/idx.scanner.service';
import type { IdxSector, SignalFilter, SetupFilter, ScanMode } from '@/services/market/idx.scanner.service';

const VALID_SECTORS: IdxSector[] = [
  'all', 'banking', 'consumer', 'mining', 'energy',
  'tech', 'property', 'telecom', 'healthcare', 'industrial',
];
const VALID_SIGNALS: SignalFilter[] = ['buy', 'sell', 'any'];
const VALID_SETUPS: SetupFilter[] = ['momentum', 'rebound', 'all_time_low', 'downtrend', 'breakout', 'oversold'];
const VALID_MODES: ScanMode[] = ['fast', 'deep'];

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const sector = (params.get('sector') ?? 'all') as IdxSector;
    const signal = (params.get('signal') ?? 'buy') as SignalFilter;
    const setup = (params.get('setup') ?? 'momentum') as SetupFilter;
    const mode = (params.get('mode') ?? 'fast') as ScanMode;

    if (!VALID_SECTORS.includes(sector)) {
      return errorResponse(`Invalid sector. Valid: ${VALID_SECTORS.join(', ')}`, 400);
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

    const scanner = new IdxScannerService();
    const result = await scanner.scan(sector, signal, setup, mode);

    return jsonResponse({
      timestamp: new Date().toISOString(),
      sector: result.sector,
      mode: result.mode,
      universeCount: result.universeCount,
      candidateCount: result.candidateCount,
      totalScanned: result.totalScanned,
      summary: {
        buyCount: result.buyCount,
        watchCount: result.watchCount,
        avoidCount: result.avoidCount,
        avgScore: result.avgScore,
        breadthSignal: result.breadthSignal,
      },
      buys: result.buys,
      watches: result.watches,
      avoids: result.avoids,
      skippedCount: result.skipped.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


