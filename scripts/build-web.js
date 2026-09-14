import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const buildConfigDir = resolve('.next', 'build-config');
mkdirSync(buildConfigDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [resolve('node_modules', 'next', 'dist', 'bin', 'next'), 'build', '--webpack'],
  {
    cwd: resolve('.'),
    env: {
      ...process.env,
      BOZ_CONFIG_DIR: buildConfigDir,
    },
    stdio: 'inherit',
  },
);

rmSync(buildConfigDir, { recursive: true, force: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
