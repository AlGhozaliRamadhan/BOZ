import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForServer } from '../../src/cli/wait-for-server';

describe('waitForServer', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('resolves after a 2xx response', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(204).end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

    await expect(waitForServer({ port: address.port, timeoutMs: 1_000 }))
      .resolves.toBeUndefined();
  });

  it('enforces a hard deadline when a request hangs', async () => {
    const server = createServer(() => undefined);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

    const startedAt = Date.now();
    await expect(waitForServer({
      port: address.port,
      timeoutMs: 150,
      requestTimeoutMs: 1_000,
    })).rejects.toThrow('within 150ms');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
