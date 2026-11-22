// ─── services/settings/custom-models.store.ts ────────────────────────────────
// Persisted catalog for the custom (9router-style) provider.
//
// The catalog used to live in `CUSTOM_AI_MODELS` inside `.env`. A connected
// router can expose well over a thousand models, and that value is written
// through the settings repository, whose per-key limit and single-line format
// are designed for credentials — not for a catalog. Keeping the catalog in its
// own JSON file removes that ceiling, keeps `.env` readable, and lets the
// picker survive a restart without re-fetching the router.
//
// `CUSTOM_AI_MODELS` still wins for entries the user pins by hand; reads merge
// both sources so nothing persisted by an older release is lost.

import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureConfigDir } from '../../utils/env-dir.js';

export interface CustomModelEntry {
  id: string;
  label: string;
}

/** Hard ceiling for one catalog. Even 200-character IDs stay around 400 KB. */
export const MAX_CUSTOM_MODELS = 2_000;
const MAX_MODEL_ID_CHARS = 200;
const CATALOG_FILE = 'custom-models.json';

function catalogPath(): string {
  return join(ensureConfigDir(), CATALOG_FILE);
}

/**
 * Accepts the shapes this file and older callers can produce: `"id"` strings,
 * `{ id, label }` objects, or `{ models: [...] }` wrappers. Anything with a
 * comma or a control character is dropped — those identifiers would corrupt
 * the comma-separated `.env` fallback and can never be a real model ID.
 */
export function sanitizeCustomModel(value: unknown): CustomModelEntry | null {
  const record = typeof value === 'string' ? { id: value } : value;
  if (!record || typeof record !== 'object') return null;
  const rawId = (record as { id?: unknown }).id;
  if (typeof rawId !== 'string') return null;
  const id = rawId.trim();
  if (!id || id.length > MAX_MODEL_ID_CHARS || /\r|\n|\0|,/.test(id)) return null;

  const rawLabel = (record as { label?: unknown }).label;
  const label =
    typeof rawLabel === 'string' && rawLabel.trim() && rawLabel.trim().length <= MAX_MODEL_ID_CHARS
      ? rawLabel.trim()
      : id;
  return { id, label };
}

/** Validated, de-duplicated, capped list in first-seen order. */
export function normalizeCustomModels(values: unknown): CustomModelEntry[] {
  const rows = Array.isArray(values)
    ? values
    : values && typeof values === 'object' && Array.isArray((values as { models?: unknown }).models)
      ? ((values as { models: unknown[] }).models)
      : [];

  const unique = new Map<string, CustomModelEntry>();
  for (const row of rows) {
    if (unique.size >= MAX_CUSTOM_MODELS) break;
    const entry = sanitizeCustomModel(row);
    if (entry && !unique.has(entry.id)) unique.set(entry.id, entry);
  }
  return Array.from(unique.values());
}

/** First sighting wins on order and label, so a fresh live listing outranks a stale saved one. */
export function mergeCustomModels(
  ...lists: readonly CustomModelEntry[][]
): CustomModelEntry[] {
  return normalizeCustomModels(lists.flat());
}

class CustomModelCatalogStore {
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Reads the catalog. A missing or unreadable file is an empty catalog: a
   * broken cache must never stop the app from starting or saving settings.
   */
  async read(): Promise<CustomModelEntry[]> {
    let contents: string;
    try {
      contents = await readFile(catalogPath(), 'utf8');
    } catch {
      return [];
    }
    try {
      return normalizeCustomModels(JSON.parse(contents));
    } catch {
      return [];
    }
  }

  /** Replaces the catalog. Returns what was actually stored after validation. */
  async write(values: unknown): Promise<CustomModelEntry[]> {
    const normalized = normalizeCustomModels(values);
    const operation = this.writeQueue
      .catch(() => undefined)
      .then(() => this.writeAtomically(normalized));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    return normalized;
  }

  private async writeAtomically(models: CustomModelEntry[]): Promise<void> {
    const target = catalogPath();
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const contents = `${JSON.stringify({ version: 1, models }, null, 0)}\n`;

    try {
      await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
      await chmod(target, 0o600).catch(() => undefined);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export const customModelCatalog = new CustomModelCatalogStore();
