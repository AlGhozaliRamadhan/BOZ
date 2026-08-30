import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { idxUniverseCachePath } from '../src/services/market/idx.universe.service';

describe('IDX universe cache location', () => {
  let directory: string | undefined;

  afterEach(async () => {
    delete process.env.BOZ_CONFIG_DIR;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('stores mutable cache under the configured per-user directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'boz-idx-cache-'));
    process.env.BOZ_CONFIG_DIR = directory;

    expect(idxUniverseCachePath()).toBe(join(directory, 'idx-universe-cache.json'));
  });
});
