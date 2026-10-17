import { describe, it, expect } from 'vitest';
import { AIService } from '../src/services/ai/ai.service.js';

const parse = (content: string) => (new AIService() as any).parseResponse(content);

describe('AIService reasoning separation', () => {
  // `<think>` narration used to be extracted into `thoughts` and rendered in
  // the same accordion as the verdict's own grounded reasons, so one label came
  // to mean two unrelated things. It now rides its own `reasoning` channel.

  it('captures a tagged scratchpad on its own channel', () => {
    const result = parse(
      '{"status":"ok","prediction":"UP","confidence":70,"strategy":"Breakout","reasons":["momentum"]}'
    );
    expect(result.reasoning).toBeUndefined();

    const withThoughts = (new AIService() as any).normalizeResult(
      { status: 'ok', prediction: 'UP', confidence: 70, reasons: ['momentum'] },
      '<think>weighed the levels carefully</think>{"status":"ok"}',
    );
    expect(withThoughts.reasoning).toBe('weighed the levels carefully');
    // Never mixed into the grounded reason list.
    expect(withThoughts.thoughts).toEqual(['momentum']);
  });

  it('never lets a scratchpad stand in for the reason a verdict failed', () => {
    // The user in front of a red verdict needs to read WHY it failed, not the
    // model's musings about it.
    const result = (new AIService() as any).normalizeResult(
      { status: 'error', reason: 'Market data provider was unreachable' },
      '<think>maybe I should have checked the feed first</think>{"status":"error"}',
    );
    expect(result.reason).toBe('Market data provider was unreachable');
    expect(result.thoughts).toEqual(['Market data provider was unreachable']);
    expect(result.thought).toBe('Market data provider was unreachable');
    // Still available, just not as the headline.
    expect(result.reasoning).toBe('maybe I should have checked the feed first');
  });

  it('applies the same precedence on an uncertain verdict', () => {
    const result = (new AIService() as any).normalizeResult(
      { status: 'uncertain', reason: 'Confirmation candle never printed' },
      '<think>waiting on the retest</think>{"status":"uncertain"}',
    );
    expect(result.thoughts).toEqual(['Confirmation candle never printed']);
    expect(result.reasoning).toBe('waiting on the retest');
  });
});

describe('AIService.parseResponse', () => {
  it('parses a perfectly structured response', () => {
    const result = parse(
      '{"status":"ok","prediction":"UP","confidence":78,"strategy":"Breakout","target_price":123.45,"stop_loss":110,"reasons":["momentum confirmation"]}'
    );

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('UP');
    expect(result.confidence).toBe(78);
    expect(result.strategy).toBe('Breakout');
    expect(result.target_price).toBeCloseTo(123.45, 6);
    expect(result.stop_loss).toBeCloseTo(110, 6);
  });

  it('parses responses without dollar signs', () => {
    const result = parse(
      '{"status":"ok","prediction":"DOWN","confidence":62,"strategy":"Pullback","target_price":98.75,"stop_loss":104.2}'
    );

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('DOWN');
    expect(result.target_price).toBeCloseTo(98.75, 6);
    expect(result.stop_loss).toBeCloseTo(104.2, 6);
  });

  it('accepts null targets when missing', () => {
    const result = parse(
      '{"status":"ok","prediction":"UP","confidence":80,"strategy":"Trend","target_price":null,"stop_loss":null}'
    );

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('UP');
    expect(result.target_price).toBeUndefined();
    expect(result.stop_loss).toBeUndefined();
  });

  it('parses a response prefixed by a think block', () => {
    const result = parse(
      '</think>\n{"status":"ok","prediction":"DOWN","confidence":60,"strategy":"Fade","target_price":987.65,"stop_loss":900}'
    );

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('DOWN');
    expect(result.confidence).toBe(60);
  });

  it('falls back to UNKNOWN on malformed response', () => {
    const result = parse('no structured content here');

    expect(result.status).toBe('uncertain');
  });
});
