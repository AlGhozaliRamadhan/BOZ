import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hoisted = vi.hoisted(() => ({
  fetchCustomProviderModels: vi.fn(),
}));

vi.mock('@/services/ai/custom-provider.client', () => ({
  fetchCustomProviderModels: hoisted.fetchCustomProviderModels,
}));

const { GET } = await import('../src/app/api/custom-models/route');
const { customModelCatalog } = await import('../src/services/settings/custom-models.store');
const { config } = await import('../src/config/config');

const ENDPOINT = 'http://localhost/api/custom-models';

describe('custom models route', { concurrent: false }, () => {
  let configDirectory: string;
  const originalConfigDir = process.env.BOZ_CONFIG_DIR;
  const originalCustomModels = process.env.CUSTOM_AI_MODELS;

  beforeAll(async () => {
    configDirectory = await mkdtemp(join(tmpdir(), 'boz-model-route-'));
    process.env.BOZ_CONFIG_DIR = configDirectory;
    delete process.env.CUSTOM_AI_MODELS;
    // The active model is pinned into the picker list; pin nothing so the
    // assertions below describe only the saved/live catalog.
    config.setAIModel('', 'custom');
  });

  afterAll(async () => {
    if (originalConfigDir === undefined) delete process.env.BOZ_CONFIG_DIR;
    else process.env.BOZ_CONFIG_DIR = originalConfigDir;
    if (originalCustomModels === undefined) delete process.env.CUSTOM_AI_MODELS;
    else process.env.CUSTOM_AI_MODELS = originalCustomModels;
    await rm(configDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    hoisted.fetchCustomProviderModels.mockReset();
    await rm(join(configDirectory, 'custom-models.json'), { force: true });
  });

  it('serves the saved catalog without contacting the router', async () => {
    await customModelCatalog.write([
      { id: 'saved/one', label: 'Saved One' },
      { id: 'saved/two', label: 'Saved Two' },
    ]);

    const response = await GET(new Request(ENDPOINT) as never);
    const payload = await response.json();

    expect(payload.source).toBe('persisted');
    expect(payload.models.map((model: { id: string }) => model.id)).toEqual([
      'saved/one',
      'saved/two',
    ]);
    expect(hoisted.fetchCustomProviderModels).not.toHaveBeenCalled();
  });

  it('fetches on refresh, merges the router list, and persists it', async () => {
    await customModelCatalog.write([{ id: 'saved/one', label: 'Saved One' }]);
    hoisted.fetchCustomProviderModels.mockResolvedValue({
      data: [{ id: 'live/a', name: 'Live A' }, { id: 'live/b' }],
    });

    const response = await GET(new Request(`${ENDPOINT}?refresh=1`) as never);
    const payload = await response.json();

    expect(payload.source).toBe('live');
    expect(payload.models.map((model: { id: string }) => model.id)).toEqual([
      'live/a',
      'live/b',
      'saved/one',
    ]);

    const saved = JSON.parse(
      await readFile(join(configDirectory, 'custom-models.json'), 'utf8'),
    );
    expect(saved.models.map((model: { id: string }) => model.id)).toEqual([
      'live/a',
      'live/b',
      'saved/one',
    ]);
  });

  it('keeps the saved catalog when the router cannot be reached', async () => {
    await customModelCatalog.write([{ id: 'saved/one', label: 'Saved One' }]);
    hoisted.fetchCustomProviderModels.mockRejectedValue(new Error('connection refused'));

    const response = await GET(new Request(`${ENDPOINT}?refresh=1`) as never);
    const payload = await response.json();

    expect(payload.source).toBe('persisted');
    expect(payload.models.map((model: { id: string }) => model.id)).toEqual(['saved/one']);
  });
});
