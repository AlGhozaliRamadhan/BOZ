import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const _require = createRequire(import.meta.url);
const pkgVersion = (_require('../../package.json') as { version?: string }).version ?? '0.0.0';

const CWD_BUILD_PATH = resolve(process.cwd(), '.env.build');
const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE_BUILD_PATH = resolve(MODULE_ROOT, '.env.build');
const VERSION_KEYS = ['BOZ_VERSION', 'BUILD_VERSION'];

let cached: string | null = null;

function readVersionFromBuildEnv(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = dotenv.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    for (const key of VERSION_KEYS) {
      const value = parsed[key];
      if (value && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

export function getBuildVersion(): string {
  if (cached) return cached;
  const buildFile = readVersionFromBuildEnv(CWD_BUILD_PATH)
    ?? readVersionFromBuildEnv(MODULE_BUILD_PATH);
  const envValue = process.env.BOZ_VERSION || process.env.BUILD_VERSION || '';
  cached = buildFile || envValue || pkgVersion;
  return cached;
}
