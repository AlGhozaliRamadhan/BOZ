import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks must be declared before importing the SUT.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

// Import after mocks so the SUT sees the mocked modules.
import { ensureConfigDir, configEnvPath } from '../src/utils/env-dir';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { join } from 'path';

const homedirMock = vi.mocked(homedir);
const mkdirSyncMock = vi.mocked(mkdirSync);

beforeEach(() => {
  delete process.env.BOZ_CONFIG_DIR;
  homedirMock.mockReset();
  mkdirSyncMock.mockReset();
  // Default: mkdirSync is a no-op (returns undefined).
  mkdirSyncMock.mockReturnValue(undefined);
});

describe('env-dir', () => {
  it('resolves to ~/.boz on POSIX-style HOME', () => {
    homedirMock.mockReturnValue('/home/test');
    expect(ensureConfigDir()).toBe(join('/home/test', '.boz'));
  });

  it('resolves to %USERPROFILE%\\.boz on Windows', () => {
    homedirMock.mockReturnValue('C:\\Users\\test');
    const dir = ensureConfigDir();
    expect(dir).toBe(join('C:\\Users\\test', '.boz'));
  });

  it('falls back to process.cwd()/.boz when no home is set', () => {
    homedirMock.mockReturnValue('');
    expect(configEnvPath()).toMatch(/\.boz[\\/]\.env$/);
  });

  it('honors an explicit BOZ_CONFIG_DIR', () => {
    homedirMock.mockReturnValue('/ignored');
    process.env.BOZ_CONFIG_DIR = join(process.cwd(), 'test-config');

    expect(ensureConfigDir()).toBe(join(process.cwd(), 'test-config'));
    expect(configEnvPath()).toBe(join(process.cwd(), 'test-config', '.env'));
  });
});

afterEach(() => {
  delete process.env.BOZ_CONFIG_DIR;
});
