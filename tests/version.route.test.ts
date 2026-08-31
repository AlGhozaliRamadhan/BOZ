import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/version/route';
import { clearUpdateCache } from '../src/utils/update-check';

describe('version route', () => {
  beforeEach(() => {
    clearUpdateCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearUpdateCache();
    vi.restoreAllMocks();
  });

  it('returns version and update check information', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '3.0.0' }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', mockFetch);

    const req = new NextRequest('http://localhost:21526/api/version');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('currentVersion');
    expect(data).toHaveProperty('latestVersion', '3.0.0');
    expect(data).toHaveProperty('updateAvailable', true);
    expect(data).toHaveProperty('updateCommand', 'npm i -g @agr77/boz');
  });

  it('supports force refresh via query parameter', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ version: callCount === 1 ? '3.0.0' : '3.1.0' }),
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', mockFetch);

    const req1 = new NextRequest('http://localhost:21526/api/version');
    const res1 = await GET(req1);
    const data1 = await res1.json();
    expect(data1.latestVersion).toBe('3.0.0');

    const req2 = new NextRequest('http://localhost:21526/api/version?force=true');
    const res2 = await GET(req2);
    const data2 = await res2.json();
    expect(data2.latestVersion).toBe('3.1.0');
  });
});
