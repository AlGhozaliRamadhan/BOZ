import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { mkdirSync } from 'fs';

export const CONFIG_DIR_NAME = '.boz';

/** Absolute path to the per-user BOZ config dir (created if missing). */
export function ensureConfigDir(): string {
  const configured = process.env.BOZ_CONFIG_DIR?.trim();
  const base = homedir() || process.cwd();
  const dir = configured
    ? (isAbsolute(configured) ? configured : resolve(configured))
    : join(base, CONFIG_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Absolute path to the per-user .env file inside the config dir. */
export function configEnvPath(): string {
  return join(ensureConfigDir(), '.env');
}
