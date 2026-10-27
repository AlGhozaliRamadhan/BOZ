import { loadUserSettingsEnv } from './services/settings/user-env';
import { log } from './utils/logger';

/**
 * Read one node builtin without a static import. See the bundle rule below.
 */
function builtinModule<T = Record<string, unknown>>(id: string): T | undefined {
  return (process as { getBuiltinModule?: (id: string) => T | undefined }).getBuiltinModule?.(id);
}

/**
 * Apply the per-user settings file to `process.env` at boot.
 *
 * BUNDLE RULE: nothing imported from this module may statically reach
 * `node:fs`, `node:path`, `node:fs/promises`, or dotenv's main entry. This file
 * is part of the instrumentation graph, and webpack compiles that graph for the
 * edge/proxy runtime as well as Node — a stray node builtin fails both the
 * build and `next dev` with "Module not found: Can't resolve 'path'". Node
 * builtins therefore come from `process.getBuiltinModule` (see
 * `user-env.ts`), and the `.env` path is resolved here rather than borrowed
 * from `src/utils/env-dir.ts`.
 */
export function registerUserSettingsEnv(): void {
  // Only the desktop shell sets BOZ_CONFIG_DIR, pointing at the directory whose
  // `.env` the settings route writes. Every other launch — `next dev` with the
  // repo `.env`, a hosted instance — intentionally skips: the ambient
  // environment is the truth there.
  const configured = process.env.BOZ_CONFIG_DIR?.trim();
  if (!configured) return;

  const path = builtinModule<typeof import('node:path')>('node:path');
  if (!path) {
    log.warn('settings', 'Could not load saved settings: node:path is unavailable in this runtime');
    return;
  }

  const file = path.join(configured, '.env');
  try {
    const loaded = loadUserSettingsEnv(file, process.env);
    if (loaded.applied.length > 0) {
      log.info('settings', `Loaded ${loaded.applied.length} saved setting(s) from ${file}`);
    }
  } catch (error) {
    // A broken settings file must not stop the app from booting; the settings
    // route reports the same problem with a readable message once it is served.
    log.warn('settings', `Could not load saved settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}
