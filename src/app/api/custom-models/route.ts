import { NextResponse } from 'next/server';
import { config } from '@/config/config';
import { parseCustomModels, CUSTOM_DEFAULT_URL } from '@/config/custom.config';
import { fetchCustomProviderModels } from '@/services/ai/custom-provider.client';

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
    const unique = new Map<string, { id: string; label: string }>();

    const rows = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && 'data' in data && Array.isArray(data.data)
        ? data.data
        : [];
    for (const row of rows) {
      const id = typeof row === 'string' ? row : row?.id;
      if (
        !id ||
        typeof id !== 'string' ||
        id.length > 200 ||
        /\r|\n|\0|,/.test(id)
      ) continue;
      unique.set(id, { id, label: id });
      if (unique.size >= 100) break;
    }

    for (const model of fallback) {
      if (unique.size >= 100) break;
      unique.set(model.id, model);
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
