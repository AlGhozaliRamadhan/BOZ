import { describe, it, expect } from 'vitest';
import { AIService } from '../src/services/ai.service.js';

const parse = (content: string) => (new AIService() as any).parseResponse(content);

describe('AIService.parseResponse', () => {
  it('parses a perfectly structured response', () => {
    const result = parse(
      'PREDICTION: UP\nCONFIDENCE: 78\nSTRATEGY: Breakout\nTARGET: $123.45\nSTOP: $110.00'
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
      'PREDICTION: DOWN\nCONFIDENCE: 62\nSTRATEGY: Pullback\nTARGET: 98.75\nSTOP: 104.20'
    );

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('DOWN');
    expect(result.target_price).toBeCloseTo(98.75, 6);
    expect(result.stop_loss).toBeCloseTo(104.2, 6);
  });

  it('parses comma-formatted numbers', () => {
    const result = parse(
      'PREDICTION: UP\nCONFIDENCE: 80\nSTRATEGY: Trend\nTARGET: $1,234.56\nSTOP: $1,100.00'
    );

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('UP');
    expect(result.target_price).toBeCloseTo(1234.56, 6);
    expect(result.stop_loss).toBeCloseTo(1100, 6);
  });

  it('parses a response prefixed by a think block', () => {
    const result = parse(
      '</think>\nPREDICTION: DOWN\nCONFIDENCE: 60\nSTRATEGY: Fade\nTARGET: $987.65\nSTOP: $900.00'
    );

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('DOWN');
    expect(result.confidence).toBe(60);
  });

  it('falls back to UNKNOWN on malformed response', () => {
    const result = parse('no structured content here');

    expect(result.status).toBe('ok');
    expect(result.prediction).toBe('UNKNOWN');
    expect(result.confidence).toBe(50);
  });
});
