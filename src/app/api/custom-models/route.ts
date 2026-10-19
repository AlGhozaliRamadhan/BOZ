import { NextResponse } from 'next/server';
import { config } from '@/config/config';
import { parseCustomModels, CUSTOM_DEFAULT_URL } from '@/config/custom.config';
import { fetchCustomProviderModels } from '@/services/ai/custom-provider.client';
import { parseModelCatalog } from '@/services/ai/provider-models.client';

function persistedModels() {
  const list = parseCustomModels(process.env.CUSTOM_AI_MODELS);
  const current = config.custom.model;
  if (current && !list.some((m) => m.id === current)) {
    list.unshift({ id: current, label: current });
  }
  return list;
}

export async function GET() {
  const endpoint = (config.custom.endpoint || CUSTOM_DEFAULT_URL).replace(/\/+$/, '');
  const apiKey = config.custom.apiKey;
  const fallback = persistedModels();

  try {
    const data = await fetchCustomProviderModels({ endpoint, apiKey, timeoutMs: 4_000 });
    // No cap: when 9router is connected the picker serves the whole catalog.
    // IDs are bounded and sanitized inside parseModelCatalog, and the amount
    // of JSON that can arrive is capped by the bounded reader (1 MB).
    const live = parseModelCatalog(data);

    const unique = new Map<string, { id: string; label: string }>();
    for (const model of live) unique.set(model.id, model);
    for (const model of fallback) {
      if (!unique.has(model.id)) unique.set(model.id, model);
    }

    const models = Array.from(unique.values());
    return NextResponse.json({
      models: models.length > 0 ? models : fallback,
      source: models.length > 0 ? 'live' : 'persisted',
    });
  } catch {
    return NextResponse.json({ models: fallback, source: 'persisted' });
  }
}
