import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { startWebServer } from '../../src/cli/dev-web.js';

// Same file the implementation spawns (`node <this> dev ...`); skip when `next` is not installed.
const NEXT_CLI = resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const PORT = 21528; // fixed port (DEFAULT_WEB_PORT=21526, start-web test uses 21527) — never 0, which is not connectable on the handle's url

const describeIfNext = existsSync(NEXT_CLI) ? describe : describe.skip;

describeIfNext('startWebServer (dev)', () => {
  let handle: ReturnType<typeof startWebServer> | null = null;

  afterAll(async () => {
    handle?.stop();
    // Give the OS a beat to actually free the port.
    await new Promise((r) => setTimeout(r, 250));
  });

  it('returns a WebServerHandle and resolves ready', async () => {
    handle = startWebServer(PORT);
    expect(handle.url).toBe(`http://127.0.0.1:${PORT}`);
    expect(handle.port).toBe(PORT);
    expect(typeof handle.stop).toBe('function');
    await expect(handle.ready).resolves.toBeUndefined();
  }, 90000);
});
