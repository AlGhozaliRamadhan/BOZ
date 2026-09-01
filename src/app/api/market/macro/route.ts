import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { MacroService } from '@/services/market/macro.service';
import { resolveSymbol } from '@/shared/market-constants';

export async function GET(request: NextRequest) {
  try {
    const requestedTicker = request.nextUrl.searchParams.get('ticker');
    const ticker = requestedTicker ? resolveSymbol(requestedTicker) : config.ticker;
    if (!ticker) return errorResponse(`Unknown ticker: ${requestedTicker}`, 400);

    const macroService = new MacroService();
    const macro = await macroService.getMacroContext(ticker);

    return jsonResponse({
      ticker,
      timestamp: new Date().toISOString(),
      ...macro,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


