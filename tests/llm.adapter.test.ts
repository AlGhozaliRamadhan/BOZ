import { describe, expect, it } from 'vitest';
import { LLMAdapter } from '../src/services/ai/llm.adapter.js';

describe('LLMAdapter.extractJson', () => {
  it('strips code fences', () => {
    const raw = '```json\n{"status":"ok"}\n```';
    const extracted = LLMAdapter.extractJson(raw);
    expect(extracted?.jsonText).toBe('{"status":"ok"}');
    expect(extracted?.warnings.length).toBeGreaterThan(0);
  });

  it('trims non-JSON text around response', () => {
    const raw = 'prefix {"status":"ok"} suffix';
    const extracted = LLMAdapter.extractJson(raw);
    expect(extracted?.jsonText).toBe('{"status":"ok"}');
    expect(extracted?.warnings.length).toBeGreaterThan(0);
  });
});

describe('LLMAdapter reasoning privacy', () => {
  it('does not surface provider-native reasoning in normalized messages', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: '## Current view\nWait for confirmation.',
      reasoning_content: 'private provider scratchpad',
    });

    expect(message.content).toBe('## Current view\nWait for confirmation.');
    expect(message.thought).toBeNull();
  });

  it('removes tagged reasoning from normalized content', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const message = normalize({
      content: '<think>private provider scratchpad</think>## Current view\nAvoid.',
    });

    expect(message.content).toBe('## Current view\nAvoid.');
    expect(message.thought).toBeNull();
  });
});
