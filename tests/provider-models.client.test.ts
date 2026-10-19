import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearProviderModelCacheForTests,
  fetchProviderModelCatalog,
  getProviderModelsCached,
  parseModelCatalog,
} from '../src/services/ai/provider-models.client';
import type { HostResolver } from '../src/services/security/outbound-url-policy';

// Catalog responses contain no real credentials, and the network is stubbed:
// DNS is injected and `fetch` is replaced, so no live request is possible.
const fakeHostResolver: HostResolver = async () => [
  { address: '93.184.216.34', family: 4 },
];

const OPEN_ROUTER_CATALOG = {
  data: [
    { id: 'deepseek/deepseek-v4', name: 'DeepSeek: V4' },
    { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini' },
  ],
};

describe('parseModelCatalog', () => {
  it('parses the common `{ data: [...] }` shape', () => {
    const models = parseModelCatalog(OPEN_ROUTER_CATALOG);
    expect(models).toEqual([
      { id: 'deepseek/deepseek-v4', label: 'DeepSeek: V4' },
      { id: 'openai/gpt-5-mini', label: 'OpenAI: GPT-5 Mini' },
    ]);
  });

  it('parses bare arrays and `{ models: [...] }` router shapes', () => {
    expect(parseModelCatalog(['openai/gpt-5-mini'])).toEqual([
      { id: 'openai/gpt-5-mini', label: 'openai/gpt-5-mini' },
    ]);
    expect(parseModelCatalog({ models: [{ name: 'github-only-entry' }] })).toEqual([
      { id: 'github-only-entry', label: 'github-only-entry' },
    ]);
  });

  it('falls back to the ID as label when rows carry no display name', () => {
    expect(parseModelCatalog({ data: [{ id: 'nvidia/nemotron' }] })).toEqual([
      { id: 'nvidia/nemotron', label: 'nvidia/nemotron' },
    ]);
  });

  it('drops unusable IDs: empty, overlong, comma-bearing, duplicated', () => {
    const malformed = {
      data: [
        '',
        '  ',
        'a'.repeat(201),
        'bad,comment',
        null,
        42,
        { id: 'openai/dup' },
        { id: 'openai/dup' },
      ],
    };
    const models = parseModelCatalog(malformed);
    expect(models).toEqual([{ id: 'openai/dup', label: 'openai/dup' }]);
  });

  it('returns an empty list for unrecognized payloads', () => {
    expect(parseModelCatalog(undefined)).toEqual([]);
    expect(parseModelCatalog({ data: 'not-a-list' })).toEqual([]);
    expect(parseModelCatalog({})).toEqual([]);
  });
});

describe('fetchProviderModelCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests {base}/models with the bearer token for cloud endpoints', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(OPEN_ROUTER_CATALOG), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchProviderModelCatalog({
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key',
      resolveHost: fakeHostResolver,
    });

    expect(models).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        redirect: 'manual',
      }),
    );
  });

  it('trims a trailing slash from upstream endpoints', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchProviderModelCatalog({
      endpoint: 'https://openrouter.example/api/v1/',
      resolveHost: fakeHostResolver,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://openrouter.example/api/v1/models');
  });

  it('throws on HTTP errors instead of parsing error bodies', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchProviderModelCatalog({
      endpoint: 'https://openrouter.example/api/v1',
      resolveHost: fakeHostResolver,
    })).rejects.toThrow('HTTP 401');
  });
});

describe('getProviderModelsCached', () => {
  beforeEach(() => {
    clearProviderModelCacheForTests();
    delete process.env.GITHUB_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  it('serves a live catalog and caches it across calls', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(OPEN_ROUTER_CATALOG), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await getProviderModelsCached('openrouter', { resolveHost: fakeHostResolver });
    const second = await getProviderModelsCached('openrouter', { resolveHost: fakeHostResolver });

    expect(first).toMatchObject({ source: 'live' });
    expect(first?.models.map((m) => m.id)).toEqual(['deepseek/deepseek-v4', 'openai/gpt-5-mini']);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for providers without an OpenAI catalog', async () => {
    for (const provider of ['anthropic', 'offline'] as const) {
      await expect(getProviderModelsCached(provider)).resolves.toBeNull();
    }
  });

  it('requires a credential before attempting key-gated cloud listings', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProviderModelsCached('github')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.GITHUB_TOKEN = 'test-token';
    const listing = await getProviderModelsCached('github', { resolveHost: fakeHostResolver });
    expect(listing).toBeNull(); // stubbed body has no usable IDs
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to null (caller serves the curated list) on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(getProviderModelsCached('openrouter', { resolveHost: fakeHostResolver })).resolves.toBeNull();
  });
});
