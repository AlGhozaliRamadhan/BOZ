import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import { MacroService } from '@/services/market/macro.service';

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    if (ticker) {
      try {
        config.setTicker(ticker);
      } catch {
        return errorResponse(`Unknown ticker: ${ticker}`, 400);
      }
    }

    const macroService = new MacroService();
    const macro = await macroService.getMacroContext();

    return jsonResponse({
      ticker: config.ticker,
      timestamp: new Date().toISOString(),
      ...macro,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}


