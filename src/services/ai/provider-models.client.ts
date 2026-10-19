// ─── services/ai/provider-models.client.ts ───────────────────────────────────
// Live model catalogs for OpenAI-compatible providers.
//
// Curated lists (`GITHUB_MODELS`, `OPENROUTER_MODELS`, …) stay small and
// opinionated, but every OpenAI-compatible provider also exposes a `/models`
// endpoint that lists everything it can serve. When a provider is connected,
// the model picker offers the full catalog instead of the hand-picked subset.
//
// Security notes carried over from the custom provider client: endpoints go
// through the outbound URL policy, responses are read through a 1 MB bounded
// reader, and IDs are validated before they ever reach a model ID field or a
// persisted `CUSTOM_AI_MODELS` string.

import { config, type AIProvider } from '../../config/config.js';
import { validateOutboundHttpUrl, type HostResolver } from '../security/outbound-url-policy.js';
import { fetchCustomProviderModels, readBoundedJson } from './custom-provider.client.js';

export interface ProviderModelEntry {
  id: string;
  label: string;
}

export type ProviderModelListingSource = 'live' | 'persisted';

export interface ProviderModelListing {
  models: ProviderModelEntry[];
  source: ProviderModelListingSource;
}

const MODEL_CACHE_TTL_MS = 5 * 60_000;
const MAX_MODEL_ID_CHARS = 200;

function extractModelId(row: unknown): string | null {
  if (typeof row === 'string') return row;
  if (row && typeof row === 'object') {
    const id = (row as { id?: unknown }).id;
    if (typeof id === 'string') return id;
    // The GitHub Models catalog names entries differently; accept `name`.
    const name = (row as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return null;
}

function extractModelLabel(row: unknown, id: string): string {
  if (row && typeof row === 'object') {
    const name = (row as { name?: unknown }).name;
    // OpenRouter-style display names ("DeepSeek: DeepSeek V4.1 Flash") beat the
    // raw ID; keep the ID as the label when the row carries no display name.
    if (typeof name === 'string' && name.trim() && name !== id) return name;
  }
  return id;
}

/**
 * Parses any OpenAI-compatible catalog payload: `{ data: [...] }` (the common
 * shape), bare arrays, or `{ models: [...] }` (some routers). Rows may be
 * plain IDs or objects carrying `id`/`name`. Unusable IDs —malformed, too
 * long, or containing commas (a comma would corrupt persisted model lists)—
 * are dropped, and duplicates collapse to the first sighting.
 */
export function parseModelCatalog(payload: unknown): ProviderModelEntry[] {
  let rows: unknown[] = [];
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) rows = data;
    else {
      const models = (payload as { models?: unknown }).models;
      if (Array.isArray(models)) rows = models;
    }
  }
  if (rows.length === 0) return [];

  const unique = new Map<string, ProviderModelEntry>();
  for (const row of rows) {
    const id = extractModelId(row);
    if (!id) continue;
    const trimmed = id.trim();
    if (
      !trimmed ||
      trimmed.length > MAX_MODEL_ID_CHARS ||
      /\r|\n|\0|,/.test(trimmed)
    ) continue;
    if (!unique.has(trimmed)) {
      unique.set(trimmed, { id: trimmed, label: extractModelLabel(row, trimmed) });
    }
  }
  return Array.from(unique.values());
}

/** Where the live `/models` endpoint lives and which credential gates it. */
interface CatalogSource {
  endpoint: string;
  apiKey?: string;
  /** Local routers (9router) may be reached over loopback. */
  allowLoopback: boolean;
  /** Cloud listings that fail with HTTP 401 without a key — don't bother. */
  credentialRequired: boolean;
}

function catalogSource(provider: AIProvider): CatalogSource | null {
  switch (provider) {
    case 'custom':
      return {
        endpoint: config.custom.endpoint,
        apiKey: config.custom.apiKey || undefined,
        allowLoopback: true,
        credentialRequired: false,
      };
    case 'openrouter':
      return {
        endpoint: config.openrouter.endpoint,
        apiKey: config.openrouter.apiKey || undefined,
        allowLoopback: false,
        credentialRequired: false,
      };
    case 'nvidia':
      return {
        endpoint: config.nvidia.baseURL,
        apiKey: config.nvidia.apiKey || undefined,
        allowLoopback: false,
        credentialRequired: false,
      };
    case 'github':
      return {
        endpoint: config.github.endpoint,
        apiKey: config.github.token || undefined,
        allowLoopback: false,
        credentialRequired: true,
      };
    case 'openai':
      return {
        endpoint: config.openai.endpoint,
        apiKey: config.openai.apiKey || undefined,
        allowLoopback: false,
        credentialRequired: true,
      };
    case 'groq':
      return {
        endpoint: config.groq.endpoint,
        apiKey: config.groq.apiKey || undefined,
        allowLoopback: false,
        credentialRequired: true,
      };
    default:
      // anthropic and offline use non-OpenAI catalog shapes; curated only.
      return null;
  }
}

export interface FetchProviderModelCatalogOptions {
  endpoint: string;
  apiKey?: string;
  allowLoopback?: boolean;
  timeoutMs?: number;
  /** DNS override for tests; production uses the system resolver. */
  resolveHost?: HostResolver;
}

/**
 * Fetches `{base}/models` and returns the parsed, validated catalog.
 * Loopback endpoints route through the custom provider client (which owns the
 * loopback policy); cloud endpoints go through the strict outbound policy.
 */
export async function fetchProviderModelCatalog(
  options: FetchProviderModelCatalogOptions,
): Promise<ProviderModelEntry[]> {
  const payload = options.allowLoopback === true
    ? await fetchCustomProviderModels({
        endpoint: options.endpoint,
        apiKey: options.apiKey,
        timeoutMs: options.timeoutMs,
      })
    : await fetchCloudCatalog(options);
  return parseModelCatalog(payload);
}

async function fetchCloudCatalog(options: FetchProviderModelCatalogOptions): Promise<unknown> {
  const url = await validateOutboundHttpUrl(
    options.endpoint,
    options.resolveHost ? { resolveHost: options.resolveHost } : {},
  );
  // URL.toString() appends a trailing slash ("…/v1/"); appending "/models"
  // directly would produce a double slash, so rebuild from origin + path.
  const base = url.origin + url.pathname.replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  const response = await fetch(`${base}/models`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? 4_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Provider model list returned HTTP ${response.status}`);
  }
  return readBoundedJson(response);
}

// ── Tiny per-provider cache ─────────────────────────────────────────────────
// Opening the model picker must not re-download a 500-entry catalog on every
// consecutive open. Five minutes keeps it fresh without hammering providers.

const cache = new Map<string, { models: ProviderModelEntry[]; expiresAt: number }>();

export function clearProviderModelCacheForTests(): void {
  cache.clear();
}

/**
 * Live catalog for a provider, cached for a few minutes. Returns `null` when
 * the provider has no OpenAI-compatible catalog (anthropic, offline), has no
 * credential where one is mandatory, or the fetch fails — callers fall back
 * to their curated list in that case (`source: 'persisted'`).
 */
export async function getProviderModelsCached(
  provider: AIProvider,
  options: { resolveHost?: HostResolver } = {},
): Promise<ProviderModelListing | null> {
  const source = catalogSource(provider);
  if (!source) return null;
  if (source.credentialRequired && !source.apiKey) return null;

  const cached = cache.get(provider);
  if (cached && cached.expiresAt > Date.now()) {
    return { models: cached.models, source: 'live' };
  }

  try {
    const models = await fetchProviderModelCatalog({
      endpoint: source.endpoint,
      apiKey: source.apiKey,
      allowLoopback: source.allowLoopback,
      resolveHost: options.resolveHost,
    });
    if (models.length === 0) return null;
    cache.set(provider, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
    return { models, source: 'live' };
  } catch {
    return null;
  }
}
