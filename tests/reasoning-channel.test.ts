import { describe, expect, it } from 'vitest';
import {
  joinVisibleText,
  readAnthropicReasoning,
  readReasoningDelta,
  readReasoningMessage,
  reasoningChunk,
  textChunk,
  toStreamChunk,
} from '../src/services/ai/reasoning-channel';

// Provider reasoning used to be generated, billed for, and thrown away: the
// adapter read `delta.content` only and hardcoded `thought: null`. These tests
// pin the typed channel that replaced it, and — more importantly — the
// separation that makes capturing it safe.

describe('readReasoningDelta', () => {
  it('reads the field names providers actually use', () => {
    // DeepSeek and Qwen
    expect(readReasoningDelta({ reasoning_content: 'weighed it' })).toBe('weighed it');
    // OpenRouter
    expect(readReasoningDelta({ reasoning: 'weighed it' })).toBe('weighed it');
    // NVIDIA mirrors the DeepSeek shape.
    expect(readReasoningDelta({ content: '', reasoning_content: 'budgeted' })).toBe('budgeted');
  });

  it('ignores providers that sent no reasoning', () => {
    expect(readReasoningDelta({ content: 'the answer' })).toBeUndefined();
    expect(readReasoningDelta(undefined)).toBeUndefined();
    expect(readReasoningDelta(null)).toBeUndefined();
  });

  it('ignores empty and whitespace-only fragments', () => {
    // Providers routinely open a reasoning block with an empty string.
    expect(readReasoningDelta({ reasoning_content: '' })).toBeUndefined();
    expect(readReasoningDelta({ reasoning_content: '   \n' })).toBeUndefined();
  });

  it('prefers a raw string over a structured reasoning summary', () => {
    // OpenRouter can send `reasoning` as an object; a summary is not the
    // scratchpad, and forwarding it would mislabel the disclosure.
    expect(readReasoningDelta({
      reasoning_content: 'raw scratchpad',
      reasoning: { type: 'reasoning', summary: [{ text: 'a summary' }] },
    })).toBe('raw scratchpad');
  });

  it('never lets a getter decide the channel', () => {
    // The custom/offline paths accept a user-configured endpoint, so a hostile
    // payload must not be able to promote its own text into the answer.
    const hostile = { content: 'safe answer' };
    Object.defineProperty(hostile, 'reasoning_content', { get: () => 'leaked' });
    expect(readReasoningDelta(hostile)).toBeUndefined();
  });

  it('reads non-streaming messages through the same path', () => {
    expect(readReasoningMessage({ reasoning_content: 'weighed it' })).toBe('weighed it');
    expect(readReasoningMessage({ content: 'answer only' })).toBeUndefined();
  });
});

describe('readAnthropicReasoning', () => {
  it('joins thinking blocks from a typed content array', () => {
    const content = [
      { type: 'thinking', thinking: 'first thought' },
      { type: 'text', text: 'visible answer' },
      { type: 'thinking', thinking: ' second thought' },
    ];
    expect(readAnthropicReasoning(content)).toBe('first thought second thought');
  });

  it('never lifts ordinary text blocks', () => {
    // The distinguishing rule: only `thinking` blocks are reasoning. Reading
    // `text` blocks too would duplicate the visible answer.
    expect(readAnthropicReasoning([{ type: 'text', text: 'the answer' }])).toBeUndefined();
  });

  it('handles junk input without throwing', () => {
    expect(readAnthropicReasoning(undefined)).toBeUndefined();
    expect(readAnthropicReasoning('not an array')).toBeUndefined();
    expect(readAnthropicReasoning([])).toBeUndefined();
  });
});

describe('toStreamChunk', () => {
  it('passes typed chunks through', () => {
    expect(toStreamChunk(textChunk('a'))).toEqual({ type: 'text', text: 'a' });
    expect(toStreamChunk(reasoningChunk('r'))).toEqual({ type: 'reasoning', text: 'r' });
  });

  it('treats a bare string as visible text', () => {
    // Keeps an un-migrated adapter working instead of silently emitting
    // nothing, which is what a blind `chunk.type` check would do.
    expect(toStreamChunk('plain')).toEqual({ type: 'text', text: 'plain' });
  });

  it('drops empty and unusable values', () => {
    expect(toStreamChunk('')).toBeNull();
    expect(toStreamChunk(undefined)).toBeNull();
    expect(toStreamChunk(null)).toBeNull();
    expect(toStreamChunk({ type: 'text', text: '' })).toBeNull();
    // An unrecognised discriminator is not guessed at.
    expect(toStreamChunk({ type: 'tool-call', text: 'x' })).toBeNull();
  });
});

describe('joinVisibleText', () => {
  it('concatenates only the visible channel', () => {
    // The property the whole module exists for: reasoning can never become
    // part of the answer by flowing through a text accumulator.
    const answer = joinVisibleText([
      reasoningChunk('private reasoning'),
      textChunk('the '),
      reasoningChunk('more private reasoning'),
      textChunk('answer'),
    ]);
    expect(answer).toBe('the answer');
    expect(answer).not.toContain('private');
  });
});