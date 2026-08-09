import { describe, it, expect, vi } from 'vitest';
import { POST as postIntradayData } from '../src/app/api/analyze/intraday/data/route.js';
import { POST as postLongtermData } from '../src/app/api/analyze/longterm/data/route.js';

describe('Analyze Data Routes', () => {
  it('returns 400 when ticker is missing in intraday data route', async () => {
    const req = new Request('http://localhost/api/analyze/intraday/data', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await postIntradayData(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Ticker is required');
  });

  it('returns 400 when ticker is missing in longterm data route', async () => {
    const req = new Request('http://localhost/api/analyze/longterm/data', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await postLongtermData(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Ticker is required');
  });
});
