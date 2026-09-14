import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

// Import after mocks so the SUT sees the mocked modules.
import { ensureConfigDir, configEnvPath } from '../src/utils/env-dir';
import { mkdirSync } from 'fs';
import { join } from 'path';

const mkdirSyncMock = vi.mocked(mkdirSync);
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

beforeEach(() => {
  delete process.env.BOZ_CONFIG_DIR;
  delete process.env.HOME;
  delete process.env.USERPROFILE;
  mkdirSyncMock.mockReset();
  // Default: mkdirSync is a no-op (returns undefined).
  mkdirSyncMock.mockReturnValue(undefined);
});

describe('env-dir', () => {
  it('resolves to ~/.boz on POSIX-style HOME', () => {
    process.env.HOME = '/home/test';
    expect(ensureConfigDir()).toBe(join('/home/test', '.boz'));
  });

  it('resolves to %USERPROFILE%\\.boz on Windows', () => {
    process.env.USERPROFILE = 'C:\\Users\\test';
    const dir = ensureConfigDir();
    expect(dir).toBe(join('C:\\Users\\test', '.boz'));
  });

  it('falls back to process.cwd()/.boz when no home is set', () => {
    expect(configEnvPath()).toMatch(/\.boz[\\/]\.env$/);
  });

  it('honors an explicit BOZ_CONFIG_DIR', () => {
    process.env.BOZ_CONFIG_DIR = join(process.cwd(), 'test-config');

    expect(ensureConfigDir()).toBe(join(process.cwd(), 'test-config'));
    expect(configEnvPath()).toBe(join(process.cwd(), 'test-config', '.env'));
  });
});

afterEach(() => {
  delete process.env.BOZ_CONFIG_DIR;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
});
