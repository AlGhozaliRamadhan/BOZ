import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `config.*.model` fields are plain module-init values, so the environment for
// the "current model" expectations must be in place before the route (and its
// config import chain) loads — hence the eager env assignment above and the
// dynamic `GET` import below.
process.env.OPENAI_AI_MODEL = 'custom-user-model';
process.env.OFFLINE_AI_MODEL = 'qwen3-14b-t4-test';

const hoisted = vi.hoisted(() => ({
  getProviderModelsCached: vi.fn(),
}));

vi.mock('@/services/ai/provider-models.client', () => ({
  getProviderModelsCached: hoisted.getProviderModelsCached,
  clearProviderModelCacheForTests: vi.fn(),
}));

const { GET } = await import('../src/app/api/models/route');

const LIVE_CATALOG = [
  { id: 'openai/live-model-a', label: 'Live A' },
  { id: 'openai/live-model-b', label: 'Live B' },
];

describe.sequential('models route', () => {
  const original = {
    openaiModel: process.env.OPENAI_AI_MODEL,
    offlineModel: process.env.OFFLINE_AI_MODEL,
  };

  beforeAll(() => {
    // Module-init values were already consumed above; these keep a restore
    // path symmetric for anything the assertions touch.
    process.env.OPENAI_AI_MODEL = original.openaiModel ?? 'custom-user-model';
    process.env.OFFLINE_AI_MODEL = original.offlineModel ?? 'qwen3-14b-t4-test';
  });

  afterAll(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('OPENAI_AI_MODEL', original.openaiModel);
    restore('OFFLINE_AI_MODEL', original.offlineModel);
  });

  beforeEach(() => {
    hoisted.getProviderModelsCached.mockReset();
  });

  it('rejects unknown providers', async () => {
    const response = await GET(new Request('http://localhost/api/models?provider=not-a-provider'));
    expect(response.status).toBe(400);
    expect(hoisted.getProviderModelsCached).not.toHaveBeenCalled();
  });

  it('merges the live catalog and keeps the active model first', async () => {
    hoisted.getProviderModelsCached.mockResolvedValue({ models: LIVE_CATALOG, source: 'live' });

    const response = await GET(new Request('http://localhost/api/models?provider=openai'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.provider).toBe('openai');
    expect(payload.source).toBe('live');
    expect(payload.models.map((m: { id: string }) => m.id)).toEqual([
      'custom-user-model', // active model stays visible even if renamed upstream
      'openai/live-model-a',
      'openai/live-model-b',
    ]);
    expect(hoisted.getProviderModelsCached).toHaveBeenCalledWith('openai');
  });

  it('serves the curated list when the live listing is unavailable', async () => {
    hoisted.getProviderModelsCached.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/models?provider=openai'));
    const payload = await response.json();

    expect(payload.source).toBe('persisted');
    expect(payload.models.map((m: { id: string }) => m.id)).toEqual([
      'custom-user-model',
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
  });

  it('returns the current model for offline (no live catalog)', async () => {
    hoisted.getProviderModelsCached.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/models?provider=offline'));
    const payload = await response.json();

    expect(payload.models).toEqual([{ id: 'qwen3-14b-t4-test', label: 'qwen3-14b-t4-test' }]);
  });
});
