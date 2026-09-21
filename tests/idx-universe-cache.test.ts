import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { IdxUniverseService, idxUniverseCachePath } from '../src/services/market/idx.universe.service';

describe('IDX universe cache location', () => {
  let directory: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.BOZ_CONFIG_DIR;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('stores mutable cache under the configured per-user directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'boz-idx-cache-'));
    process.env.BOZ_CONFIG_DIR = directory;

    expect(idxUniverseCachePath()).toBe(join(directory, 'idx-universe-cache.json'));
  });

  it('uses the bundled IDX fallback when the remote dataset is unavailable', async () => {
    directory = await mkdtemp(join(tmpdir(), 'boz-idx-fallback-'));
    process.env.BOZ_CONFIG_DIR = directory;
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('offline'));

    const stocks = await new IdxUniverseService().getUniverse(true);

    expect(stocks.length).toBeGreaterThanOrEqual(20);
    expect(stocks.some(stock => stock.ticker === 'BBCA.JK')).toBe(true);
    expect(stocks.every(stock => stock.ticker.endsWith('.JK'))).toBe(true);
  });
});
