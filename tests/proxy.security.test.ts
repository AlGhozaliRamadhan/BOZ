import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

function apiRequest(path: string, init: RequestInit & { host?: string } = {}): NextRequest {
  const { host = '127.0.0.1:3000', ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  headers.set('host', host);
  return new NextRequest(`http://127.0.0.1:3000${path}`, { ...requestInit, headers });
}

describe('local API proxy boundary', () => {
  it('rejects non-loopback Host headers', () => {
    expect(proxy(apiRequest('/api/settings', { host: 'attacker.example' })).status).toBe(403);
  });

  it('rejects cross-origin and opaque-origin writes', () => {
    const crossOrigin = apiRequest('/api/settings', {
      method: 'PUT',
      headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(proxy(crossOrigin).status).toBe(403);

    const opaque = apiRequest('/api/chat', {
      method: 'POST',
      headers: { origin: 'null', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(proxy(opaque).status).toBe(403);
  });

  it('allows same-origin JSON and bodyless local requests', () => {
    const sameOrigin = apiRequest('/api/chat', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(proxy(sameOrigin).status).toBe(200);
    expect(proxy(apiRequest('/api/settings/test', { method: 'POST' })).status).toBe(200);
  });

  it('rejects simple cross-origin text bodies before a route can spend provider quota', () => {
    const request = apiRequest('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(proxy(request).status).toBe(415);
  });
});
