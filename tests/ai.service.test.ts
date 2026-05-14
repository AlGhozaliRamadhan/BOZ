import { describe, it, expect } from 'vitest';
import { AIService } from '../src/services/ai.service.js';

const parse = (content: string) => (new AIService() as any).parseResponse(content);

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
