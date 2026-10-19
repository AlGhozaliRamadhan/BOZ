// ─── chat/_lib/model-groups.ts ───────────────────────────────────────────────
// Folder grouping for the chat model picker.
//
// OpenAI-compatible catalogs hand back hundreds of IDs in the form
// `openai/gpt-5-mini`, `anthropic/claude-haiku-4-5`, `meta-llama/…` — one flat
// list of those is unreadable. Everything sharing the same prefix before the
// first `/` belongs in one folder; IDs without a prefix (OpenAI's own
// `gpt-6-astra`, user-typed custom IDs) stay top-level rows.
//
// Pure module: no React, no DOM, no network — unit tests and the picker both
// import it directly.

export interface ChatModelOption {
  id: string;
  label?: string;
}

export interface ModelPrefixGroup {
  prefix: string;
  models: ChatModelOption[];
}

export interface GroupedModels {
  groups: ModelPrefixGroup[];
  ungrouped: ChatModelOption[];
}

/**
 * The folder key for a model ID, or `null` when the ID has no vendor prefix.
 * A leading slash ("/weird-model") is not a prefix — it has no vendor before
 * it — so it is treated the same as a bare ID.
 */
export function modelPrefixOf(id: string): string | null {
  const slash = id.indexOf('/');
  return slash <= 0 ? null : id.slice(0, slash);
}

/**
 * Groups models by their vendor prefix. Models keep their original order
 * inside a group; groups are sorted alphabetically so the folder list is
 * stable regardless of upstream catalog order.
 */
export function groupModelsByPrefix(models: ChatModelOption[]): GroupedModels {
  const byPrefix = new Map<string, ChatModelOption[]>();
  const ungrouped: ChatModelOption[] = [];

  for (const model of models) {
    const prefix = model.id ? modelPrefixOf(model.id) : null;
    if (!prefix) {
      ungrouped.push(model);
      continue;
    }
    let bucket = byPrefix.get(prefix);
    if (!bucket) {
      bucket = [];
      byPrefix.set(prefix, bucket);
    }
    bucket.push(model);
  }

  const groups = Array.from(byPrefix.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, groupModels]) => ({ prefix, models: groupModels }));

  return { groups, ungrouped };
}
