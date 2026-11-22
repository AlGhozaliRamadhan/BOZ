// ─── services/settings/custom-models.service.ts ──────────────────────────────
// Read/write the custom provider's model catalog. The persisted JSON catalog
// owns the bulk of the list; `.env` keeps hand-pinned IDs so a value written by
// an older release (or by hand) is never lost.

import { config } from '../../config/config.js';
import { parseCustomModels } from '../../config/custom.config.js';
import {
  customModelCatalog,
  mergeCustomModels,
  type CustomModelEntry,
} from './custom-models.store.js';

/** IDs pinned in `CUSTOM_AI_MODELS`, plus the model currently in use. */
export function pinnedCustomModels(): CustomModelEntry[] {
  const list = parseCustomModels(process.env.CUSTOM_AI_MODELS);
  const current = config.custom.model;
  if (current && !list.some((model) => model.id === current)) {
    list.unshift({ id: current, label: current });
  }
  return list;
}

/** The full picker list: persisted catalog first, then pinned entries. */
export async function readCustomModels(): Promise<CustomModelEntry[]> {
  return mergeCustomModels(await customModelCatalog.read(), pinnedCustomModels());
}

/** Replaces the catalog and mirrors it into the in-memory config. */
export async function writeCustomModels(models: unknown): Promise<CustomModelEntry[]> {
  const stored = await customModelCatalog.write(models);
  config.custom.models = mergeCustomModels(stored, pinnedCustomModels());
  return stored;
}

/**
 * Ensures a single model exists in the catalog. Selecting a model the router
 * did not list (or listed before the catalog was fetched) must still survive a
 * restart, so the active model is always persisted.
 */
export async function ensureCustomModel(id: string): Promise<void> {
  const catalog = await customModelCatalog.read();
  if (catalog.some((model) => model.id === id)) return;
  await writeCustomModels([...catalog, { id, label: id }]);
}
