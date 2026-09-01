import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configEnvPath } from '../src/utils/env-dir';

describe.sequential('config credential permissions', () => {
  const original = process.env.BOZ_CONFIG_DIR;
  let directory = '';

  afterEach(() => {
    if (original === undefined) delete process.env.BOZ_CONFIG_DIR;
    else process.env.BOZ_CONFIG_DIR = original;
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('repairs an existing credential file to mode 0600 where supported', () => {
    directory = mkdtempSync(join(tmpdir(), 'boz-env-mode-'));
    process.env.BOZ_CONFIG_DIR = directory;
    const target = join(directory, '.env');
    writeFileSync(target, 'GITHUB_TOKEN=test-only\n', { mode: 0o644 });
    if (process.platform !== 'win32') chmodSync(target, 0o644);

    expect(configEnvPath()).toBe(target);
    if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});
