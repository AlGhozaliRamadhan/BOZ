import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/desktop/health/route';

const originalToken = process.env.BOZ_DESKTOP_HEALTH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.BOZ_DESKTOP_HEALTH_TOKEN;
  else process.env.BOZ_DESKTOP_HEALTH_TOKEN = originalToken;
});

describe('desktop health route', () => {
  it('returns the BOZ desktop readiness contract for the sidecar token', async () => {
    process.env.BOZ_DESKTOP_HEALTH_TOKEN = 'test-health-token';
    const response = await GET(new Request('http://127.0.0.1:21526/api/desktop/health', {
      headers: { 'x-boz-desktop-token': 'test-health-token' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: 'BOZ',
      distribution: 'desktop',
      status: 'ready',
    });
  });

  it('does not expose readiness without the private token', async () => {
    process.env.BOZ_DESKTOP_HEALTH_TOKEN = 'test-health-token';
    const response = await GET(new Request('http://127.0.0.1:21526/api/desktop/health'));
    expect(response.status).toBe(404);
  });
});
