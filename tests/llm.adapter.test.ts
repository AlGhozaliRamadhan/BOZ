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
