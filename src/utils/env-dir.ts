import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'fs';

export const CONFIG_DIR_NAME = '.boz';

/** Absolute path to the per-user BOZ config dir (created if missing). */
export function ensureConfigDir(): string {
  const configured = process.env.BOZ_CONFIG_DIR?.trim();
  const base = homedir() || process.cwd();
  const dir = configured
    ? (isAbsolute(configured) ? configured : resolve(configured))
    : join(base, CONFIG_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* Windows and restricted filesystems may not expose POSIX modes. */ }
  return dir;
}

/** Absolute path to the per-user .env file inside the config dir. */
export function configEnvPath(): string {
  const target = join(ensureConfigDir(), '.env');
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BOZ config .env must be a regular file');
    try { chmodSync(target, 0o600); } catch { /* Best effort on non-POSIX filesystems. */ }
  }
  return target;
}
