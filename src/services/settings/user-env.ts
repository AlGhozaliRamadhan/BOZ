import { SETTINGS_ENV_KEYS, type SettingsEnvKey } from '../../shared/settings-env-keys.js';

export interface LoadedUserSettingsEnv {
  path: string;
  /** Keys this load supplied, i.e. those the process did not already have. */
  applied: string[];
}

const SETTINGS_ENV_KEY_SET = new Set<string>(SETTINGS_ENV_KEYS);

/**
 * Read one node builtin without a static import.
 *
 * This module is reachable from the instrumentation graph, which webpack
 * compiles for the edge/proxy runtime as well as Node. A static `node:fs` or
 * `node:path` import there fails the build with "Module not found: Can't
 * resolve 'path'". `process.getBuiltinModule` (Node >= 22.3; the bundled
 * sidecar runs a newer one) hands over the same object without the bundler
 * seeing it.
 */
function builtinModule<T = Record<string, unknown>>(id: string): T | undefined {
  return (process as { getBuiltinModule?: (id: string) => T | undefined }).getBuiltinModule?.(id);
}

/**
 * Parse a `.env` document the way BOZ writes one.
 *
 * The settings repository keeps every value on a single line and forbids
 * control characters (`validateEnvValue` rejects \r, \n, \0), so this needs far
 * less than dotenv: blank lines, whole-line `#` comments, `KEY=value`, an
 * optional `export` prefix, and one pair of wrapping quotes for files edited by
 * hand. Values containing `=` (base64 keys do) are kept whole, split on the
 * first separator.
 */
export function parseSettingsDocument(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const stripped = trimmed.replace(/^export\s+/, '');
    const separator = stripped.indexOf('=');
    if (separator === -1) continue;

    const key = stripped.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = stripped.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Apply BOZ's per-user settings file to `process.env`.
 *
 * Settings saved in the app are written to `<config dir>/.env`, but nothing used
 * to read that file: the packaged sidecar runs with its cwd inside the bundled
 * server, which has no `.env`, and Next only loads dotenv files from there. So a
 * saved provider held until the next restart and was then replaced by whatever
 * the ambient OS environment implied — the reason a 9router setup could come
 * back up as OpenAI.
 *
 * Existing process env wins (`override: false` semantics) so a developer's repo
 * `.env` still takes precedence during `npm run dev`.
 *
 * Only keys in {@link SETTINGS_ENV_KEYS} are applied. The file is user-writable,
 * and expanding it into an arbitrary environment variable (PATH, NODE_OPTIONS)
 * would turn a settings file into code execution.
 */
export function loadUserSettingsEnv(
  envPath: string,
  env: NodeJS.ProcessEnv = process.env,
): LoadedUserSettingsEnv {
  const fs = builtinModule<typeof import('node:fs')>('node:fs');
  if (!fs) {
    throw new Error(`loadUserSettingsEnv needs the node runtime (${envPath} could not be read)`);
  }

  let contents: string;
  try {
    contents = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: envPath, applied: [] };
    throw error;
  }

  const parsed = parseSettingsDocument(contents);
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!SETTINGS_ENV_KEY_SET.has(key as SettingsEnvKey)) continue;
    if ((env[key] || '').trim()) continue;
    env[key] = value;
    applied.push(key);
  }
  return { path: envPath, applied };
}
