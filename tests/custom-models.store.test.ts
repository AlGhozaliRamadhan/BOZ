import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_CUSTOM_MODELS,
  customModelCatalog,
  mergeCustomModels,
  normalizeCustomModels,
  sanitizeCustomModel,
} from '../src/services/settings/custom-models.store';

describe('custom model catalog store', { concurrent: false }, () => {
  let configDirectory: string;
  const originalConfigDir = process.env.BOZ_CONFIG_DIR;

  beforeAll(async () => {
    configDirectory = await mkdtemp(join(tmpdir(), 'boz-model-catalog-'));
    process.env.BOZ_CONFIG_DIR = configDirectory;
  });

  afterAll(async () => {
    if (originalConfigDir === undefined) delete process.env.BOZ_CONFIG_DIR;
    else process.env.BOZ_CONFIG_DIR = originalConfigDir;
    await rm(configDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(join(configDirectory, 'custom-models.json'), { force: true });
  });

  it('sanitizes identifiers and drops anything that cannot round-trip', () => {
    expect(sanitizeCustomModel('  openai/gpt-5  ')).toEqual({
      id: 'openai/gpt-5',
      label: 'openai/gpt-5',
    });
    expect(sanitizeCustomModel({ id: 'a/b', label: 'Display Name' })).toEqual({
      id: 'a/b',
      label: 'Display Name',
    });
    // A comma would corrupt the comma-separated `.env` fallback.
    expect(sanitizeCustomModel('a,b')).toBeNull();
    expect(sanitizeCustomModel('line\nbreak')).toBeNull();
    expect(sanitizeCustomModel('   ')).toBeNull();
    expect(sanitizeCustomModel('x'.repeat(201))).toBeNull();
    expect(sanitizeCustomModel({ nope: true })).toBeNull();
    expect(sanitizeCustomModel(null)).toBeNull();
  });

  it('deduplicates and caps an oversized catalog', () => {
    const rows = Array.from({ length: MAX_CUSTOM_MODELS + 25 }, (_, index) => ({
      id: `model-${index}`,
      label: `Model ${index}`,
    }));
    rows.push({ id: 'model-0', label: 'Duplicate' });

    const normalized = normalizeCustomModels({ models: rows });

    expect(normalized).toHaveLength(MAX_CUSTOM_MODELS);
    expect(normalized[0]).toEqual({ id: 'model-0', label: 'Model 0' });
  });

  it('merges lists without losing order and lets a later label win', () => {
    const merged = mergeCustomModels(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      [{ id: 'b', label: 'Bee' }, { id: 'c', label: 'C' }],
    );
    expect(merged).toEqual([
      { id: 'a', label: 'A' },
      // First sighting fixes the order; the later entry replaces the label.
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
  });

  it('writes and reads a large catalog', async () => {
    const models = Array.from({ length: 750 }, (_, index) => ({
      id: `router/model-${index}`,
      label: `Router Model ${index}`,
    }));

    const stored = await customModelCatalog.write(models);
    expect(stored).toHaveLength(750);

    const file = JSON.parse(
      await readFile(join(configDirectory, 'custom-models.json'), 'utf8'),
    );
    expect(file.version).toBe(1);
    expect(file.models).toHaveLength(750);

    await expect(customModelCatalog.read()).resolves.toHaveLength(750);
  });

  it('treats a missing or corrupt file as an empty catalog', async () => {
    await expect(customModelCatalog.read()).resolves.toEqual([]);
  });
});
