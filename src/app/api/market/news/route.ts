import { NextRequest } from 'next/server';
import { newsFetchService } from '@/services/news/news.fetch.service';
import { jsonResponse, errorResponse } from '@/app/lib/api-helpers';

/** Top strip shows two headline chips; the extra depth feeds the popover. */
const MAX_STRIP_HEADLINES = 12;

/**
 * GET /api/market/news — the few newest market headlines across every
 * category, for the always-visible intel strip. News ordering is recency: the
 * strip answers "what is happening right now", not "what is regional".
 *
 * The service owns per-category caches (180–600s TTL), so this route is a
 * thin, cheap read for the shell — same discipline as /api/market/quotes,
 * client polling is the cache policy.
 */
export async function GET(_request: NextRequest) {
  try {
    const data = await newsFetchService.fetchAll(false);
    const headlines = [...(data.all ?? [])]
      .filter((item) => item?.title)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, MAX_STRIP_HEADLINES)
      .map((item) => ({
        title: item.title,
        source: item.source,
        timestamp: item.timestamp,
        url: item.url ?? null,
        impact: item.impact,
        category: item.category,
      }));
    return jsonResponse({ generatedAt: new Date().toISOString(), headlines });
  } catch (err) {
    return errorResponse(
      `News unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
