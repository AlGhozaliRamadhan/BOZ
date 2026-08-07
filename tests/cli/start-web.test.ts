import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import http from 'http';
import { startWebServer } from '../../src/cli/start-web.js';

const STANDALONE_SERVER = resolve(process.cwd(), '.next', 'standalone', 'server.js');

const describeIfBuilt = existsSync(STANDALONE_SERVER) ? describe : describe.skip;

describeIfBuilt('startWebServer (requires `npm run build` first)', () => {
  const port = 21527;

  let handle: ReturnType<typeof startWebServer> | null = null;

  afterAll(async () => {
    if (handle) handle.stop();
    await new Promise((r) => setTimeout(r, 250));
  });

  it('returns a handle immediately and resolves ready within 8s', async () => {
    handle = startWebServer(port);
    expect(handle.url).toBe(`http://127.0.0.1:${port}`);
    expect(handle.port).toBe(port);
    expect(typeof handle.stop).toBe('function');

    const start = Date.now();
    await handle.ready;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(8000);
  }, 10000);

  it('GET / returns 2xx after ready', async () => {
    if (!handle) handle = startWebServer(port);
    await handle.ready;

    const status = await new Promise<number>((resolveP, rejectP) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        resolveP(res.statusCode ?? 0);
      });
      req.on('error', rejectP);
    });
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
  }, 10000);
});
