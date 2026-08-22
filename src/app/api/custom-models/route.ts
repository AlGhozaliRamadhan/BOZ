import { NextResponse } from 'next/server';
import { config } from '@/config/config';
import { parseCustomModels, CUSTOM_DEFAULT_URL } from '@/config/custom.config';

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
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(`${endpoint}/models`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return NextResponse.json({ models: fallback, source: 'persisted', endpoint });
    }

    const data = await res.json();
    const unique = new Map<string, { id: string; label: string }>();

    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    for (const row of rows) {
      const id = typeof row === 'string' ? row : row?.id;
      if (!id || typeof id !== 'string') continue;
      unique.set(id, { id, label: id });
    }

    for (const m of fallback) unique.set(m.id, m);

    const models = Array.from(unique.values());
    return NextResponse.json({
      models: models.length > 0 ? models : fallback,
      source: models.length > 0 ? 'live' : 'persisted',
      endpoint,
    });
  } catch {
    return NextResponse.json({ models: fallback, source: 'persisted', endpoint });
  }
}
