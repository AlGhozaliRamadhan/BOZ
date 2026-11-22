import { describe, expect, it } from 'vitest';
import {
  MODEL_PICKER_RENDER_LIMIT,
  filterModelOptions,
  type ModelOption,
} from '../src/app/components/ui/model-picker';

const MODELS: ModelOption[] = [
  { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
];

describe('filterModelOptions', () => {
  it('keeps catalog order and pins the active model first', () => {
    const view = filterModelOptions(MODELS, '', 'deepseek/deepseek-v4.1-flash');
    expect(view.models.map((model) => model.id)).toEqual([
      'deepseek/deepseek-v4.1-flash',
      'openai/gpt-5.6-sol',
      'anthropic/claude-sonnet-5',
    ]);
    expect(view.total).toBe(3);
    expect(view.truncated).toBe(false);
  });

  it('does not reorder while searching', () => {
    const view = filterModelOptions(MODELS, 'claude', 'openai/gpt-5.6-sol');
    expect(view.models.map((model) => model.id)).toEqual(['anthropic/claude-sonnet-5']);
  });

  it('matches on the display label as well as the id', () => {
    expect(filterModelOptions(MODELS, 'flash').models.map((m) => m.id)).toEqual([
      'deepseek/deepseek-v4.1-flash',
    ]);
    expect(filterModelOptions(MODELS, 'DEEPSEEK').models).toHaveLength(1);
  });

  it('returns no rows for a query that matches nothing', () => {
    const view = filterModelOptions(MODELS, 'not-a-model', 'openai/gpt-5.6-sol');
    expect(view.models).toEqual([]);
    expect(view.total).toBe(0);
  });

  it('caps rendering for a huge catalog and reports the real total', () => {
    const huge = Array.from({ length: MODEL_PICKER_RENDER_LIMIT + 40 }, (_, index) => ({
      id: `router/model-${index}`,
      label: `Model ${index}`,
    }));
    const view = filterModelOptions(huge, '');
    expect(view.models).toHaveLength(MODEL_PICKER_RENDER_LIMIT);
    expect(view.total).toBe(MODEL_PICKER_RENDER_LIMIT + 40);
    expect(view.truncated).toBe(true);
  });
});
