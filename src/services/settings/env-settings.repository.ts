import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { configEnvPath } from '../../utils/env-dir.js';

export const SETTINGS_ENV_KEYS = [
  'AI_PROVIDER',
  'GITHUB_AI_MODEL',
  'GITHUB_TOKEN',
  'NVIDIA_AI_MODEL',
  'NVIDIA_API_KEY',
  'OFFLINE_AI_MODEL',
  'CUSTOM_AI_URL',
  'CUSTOM_AI_KEY',
  'CUSTOM_AI_MODEL',
  'CUSTOM_AI_MODELS',
] as const;

export type SettingsEnvKey = typeof SETTINGS_ENV_KEYS[number];
export type SettingsEnvUpdates = Partial<Record<SettingsEnvKey, string | null>>;

const SETTINGS_ENV_KEY_SET = new Set<string>(SETTINGS_ENV_KEYS);
const MAX_ENV_VALUE_LENGTH = 8_192;

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

function validateEnvValue(key: SettingsEnvKey, value: string): string {
  if (value.length > MAX_ENV_VALUE_LENGTH) {
    throw new SettingsValidationError(`${key} exceeds ${MAX_ENV_VALUE_LENGTH} characters`);
  }
  if (/\r|\n|\0/.test(value)) {
    throw new SettingsValidationError(`${key} contains a forbidden control character`);
  }
  return value.trim();
}

function updateEnvDocument(contents: string, updates: SettingsEnvUpdates): string {
  const pending = new Map<string, string>();
  for (const [key, value] of Object.entries(updates)) {
    if (!SETTINGS_ENV_KEY_SET.has(key)) {
      throw new SettingsValidationError(`Unsupported settings key: ${key}`);
    }
    if (value !== null && value !== undefined) {
      pending.set(key, validateEnvValue(key as SettingsEnvKey, value));
    }
  }

  const output: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    const key = match?.[1];
    if (!key || !(key in updates)) {
      output.push(line);
      continue;
    }

    const replacement = pending.get(key);
    if (replacement !== undefined) {
      output.push(`${key}=${replacement}`);
      pending.delete(key);
    }
  }

  while (output.length > 0 && output[output.length - 1] === '') output.pop();
  for (const [key, value] of pending) output.push(`${key}=${value}`);
  return output.length > 0 ? `${output.join('\n')}\n` : '';
}

export class EnvSettingsRepository {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly envPath: () => string = configEnvPath) {}

  update(updates: SettingsEnvUpdates): Promise<void> {
    const operation = this.writeQueue
      .catch(() => undefined)
      .then(() => this.writeAtomically(updates));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private async writeAtomically(updates: SettingsEnvUpdates): Promise<void> {
    const target = this.envPath();
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let contents = '';

    try {
      contents = await readFile(target, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const next = updateEnvDocument(contents, updates);
    try {
      await writeFile(temporary, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
      await chmod(target, 0o600).catch(() => undefined);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export const settingsRepository = new EnvSettingsRepository();
