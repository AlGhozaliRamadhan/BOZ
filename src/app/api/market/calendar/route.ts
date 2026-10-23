import { NextRequest } from 'next/server';
import { getMarketCalendar } from '@/services/market/calendar.service';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';

/**
 * GET /api/market/calendar — fetched exchange-closure intelligence for the
 * app-shell market-intel strip: which calendar days IDX and the US markets
 * are closed (holidays) so the day squares and session chips derive green/red
 * from real data instead of a weekend guess.
 *
 * The service caches per market, so repeated strip mounts cost one feed call
 * per market at most every 12h. All failures degrade to `source:
 * 'unavailable'` lists (HTTP 200): the strip renders weekend-rule squares and
 * says so. An error status here would only paint bubbles red in devtools.
 */
export async function GET(_request: NextRequest) {
  try {
    const payload = await getMarketCalendar();
    return jsonResponse(payload);
  } catch (err) {
    return errorResponse(
      `Market calendar unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
