import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

export const CONFIG_DIR_NAME = '.boz';

/** Absolute path to the per-user BOZ config dir (created if missing). */
export function ensureConfigDir(): string {
  const base = homedir() || process.cwd();
  const dir = join(base, CONFIG_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path to the per-user .env file inside the config dir. */
export function configEnvPath(): string {
  return join(ensureConfigDir(), '.env');
}
