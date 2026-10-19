import { describe, expect, it } from 'vitest';
import {
  groupModelsByPrefix,
  modelPrefixOf,
} from '../src/app/chat/_lib/model-groups';

describe('modelPrefixOf', () => {
  it('returns the vendor prefix of a prefixed ID', () => {
    expect(modelPrefixOf('openai/gpt-5-mini')).toBe('openai');
    expect(modelPrefixOf('anthropic/claude-haiku-4-5')).toBe('anthropic');
    expect(modelPrefixOf('meta-llama/Llama-4-Scout')).toBe('meta-llama');
  });

  it('keeps everything after the first slash out of the prefix', () => {
    // Nested prefixes group under the first segment only.
    expect(modelPrefixOf('openrouter/xkiro/claude')).toBe('openrouter');
  });

  it('returns null for IDs without a vendor prefix', () => {
    expect(modelPrefixOf('gpt-6-astra')).toBeNull();
    expect(modelPrefixOf('')).toBeNull();
    // A leading slash has no vendor before it — not a prefix.
    expect(modelPrefixOf('/weird-model')).toBeNull();
  });
});

describe('groupModelsByPrefix', () => {
  it('groups models sharing a prefix into one folder', () => {
    const result = groupModelsByPrefix([
      { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B Free' },
      { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'deepseek/deepseek-v4', label: 'DeepSeek V4' },
    ]);

    expect(result.ungrouped).toEqual([]);
    expect(result.groups).toEqual([
      expect.objectContaining({ prefix: 'anthropic', models: [expect.objectContaining({ id: 'anthropic/claude-haiku-4-5' })] }),
      expect.objectContaining({ prefix: 'deepseek', models: [expect.objectContaining({ id: 'deepseek/deepseek-v4' })] }),
      expect.objectContaining({
        prefix: 'openai',
        models: [
          expect.objectContaining({ id: 'openai/gpt-oss-120b:free' }),
          expect.objectContaining({ id: 'openai/gpt-5-mini' }),
        ],
      }),
    ]);
  });

  it('sorts folders alphabetically for a stable list', () => {
    const result = groupModelsByPrefix([
      { id: 'zeta/model-a' },
      { id: 'alpha/model-b' },
      { id: 'mid/model-c' },
    ]);
    expect(result.groups.map((g) => g.prefix)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('keeps unprefixed models as top-level rows, first', () => {
    const result = groupModelsByPrefix([
      { id: 'openai/gpt-5-mini' },
      { id: 'gpt-6-astra' },
      { id: 'my-custom-model' },
    ]);
    expect(result.ungrouped.map((m) => m.id)).toEqual(['gpt-6-astra', 'my-custom-model']);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].prefix).toBe('openai');
  });

  it('preserves upstream order inside a folder', () => {
    const result = groupModelsByPrefix([
      { id: 'openai/first' },
      { id: 'openai/second' },
      { id: 'openai/third' },
    ]);
    expect(result.groups[0].models.map((m) => m.id)).toEqual(['openai/first', 'openai/second', 'openai/third']);
  });

  it('returns empty structures for an empty or malformed input', () => {
    expect(groupModelsByPrefix([])).toEqual({ groups: [], ungrouped: [] });
    const result = groupModelsByPrefix([{ id: '' } as { id: string }]);
    expect(result).toEqual({ groups: [], ungrouped: [expect.objectContaining({ id: '' })] });
  });
});
