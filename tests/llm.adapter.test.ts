import { describe, expect, it, vi } from 'vitest';
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

  it('retains only an explicitly public complete note beside tool calls', () => {
    const normalize = (LLMAdapter as any).normalizeOpenAIResponse.bind(LLMAdapter);
    const tool_calls = [{ id: '1', type: 'function', function: { name: 'fetch_price', arguments: '{}' } }];
    const message = normalize({
      content: '<think>private</think>Discard this preamble.<analysis_note>I will compare trend strength and catalysts.</analysis_note>',
      reasoning_content: 'private provider reasoning', tool_calls,
    });
    expect(message.content).toBe('<analysis_note>I will compare trend strength and catalysts.</analysis_note>');
    expect(message.thought).toBeNull();
    expect(normalize({ content: '<analysis_note>unfinished', tool_calls }).content).toBeNull();
    expect(normalize({ content: 'unmarked scratchpad', tool_calls }).content).toBeNull();
  });

  it('preserves public notes from offline tool responses', () => {
    const parse = (LLMAdapter as any).parseOfflineToolResponse.bind(LLMAdapter);
    const message = parse('<analysis_note>I will check the current price.</analysis_note>\n{"tool":"fetch_price","args":{"symbol_or_name":"NVDA"}}');
    expect(message.content).toContain('I will check');
    expect(message.tool_calls).toHaveLength(1);
  });

  it('preserves public notes from Anthropic text blocks alongside tool use', async () => {
    const adapter = new LLMAdapter() as any;
    vi.spyOn(adapter, 'createAnthropicMessage').mockResolvedValue({ content: [
      { type: 'thinking', text: 'private' },
      { type: 'text', text: '<analysis_note>I will compare the two approaches.</analysis_note>' },
      { type: 'tool_use', id: 't1', name: 'fetch_price', input: { symbol_or_name: 'NVDA' } },
    ] });
    const message = await adapter.callAnthropicWithTools({ messages: [], tools: [], maxTokens: 100, toolChoice: 'auto' });
    expect(message.content).toBe('<analysis_note>I will compare the two approaches.</analysis_note>');
    expect(message.tool_calls).toHaveLength(1);
  });
});
