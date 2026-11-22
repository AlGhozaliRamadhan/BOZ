import { NextResponse, type NextRequest } from 'next/server';
import { config } from '@/config/config';
import { CUSTOM_DEFAULT_URL } from '@/config/custom.config';
import { fetchCustomProviderModels } from '@/services/ai/custom-provider.client';
import { parseModelCatalog } from '@/services/ai/provider-models.client';
import {
  readCustomModels,
  writeCustomModels,
} from '@/services/settings/custom-models.service';
import { mergeCustomModels } from '@/services/settings/custom-models.store';

/**
 * `GET /api/custom-models` returns the saved catalog without touching the
 * router, so opening Settings is instant and works offline.
 *
 * `GET /api/custom-models?refresh=1` asks the router for its `/models` list,
 * merges it with what is already saved, and persists the result. Persisting on
 * the server is what makes a large 9router catalog survive a restart: the old
 * flow sent the whole list back through the settings endpoint, which could not
 * store it.
 */
export async function GET(request: NextRequest) {
  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  const persisted = await readCustomModels();

  if (!refresh) {
    return NextResponse.json({ models: persisted, source: 'persisted' });
  }

  const endpoint = (config.custom.endpoint || CUSTOM_DEFAULT_URL).replace(/\/+$/, '');
  try {
    const data = await fetchCustomProviderModels({
      endpoint,
      apiKey: config.custom.apiKey,
      timeoutMs: 8_000,
    });
    const live = parseModelCatalog(data);
    if (live.length === 0) {
      return NextResponse.json({ models: persisted, source: 'persisted' });
    }

    const merged = mergeCustomModels(live, persisted);
    // A failed write must not hide a catalog the router just served; the next
    // refresh tries again.
    await writeCustomModels(merged).catch(() => undefined);
    return NextResponse.json({ models: merged, source: 'live' });
  } catch {
    return NextResponse.json({ models: persisted, source: 'persisted' });
  }
}
