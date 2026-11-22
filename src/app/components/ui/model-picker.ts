// Pure helpers for the settings model picker. Kept separate from the React
// component so the filtering/ordering rules can be tested without a DOM.

export interface ModelOption {
  id: string;
  label: string;
}

/** Rendering 2 000 rows at once stalls the modal; search narrows the rest. */
export const MODEL_PICKER_RENDER_LIMIT = 200;

export interface ModelPickerView {
  /** Rows to render, active model first when the query is empty. */
  models: ModelOption[];
  /** Matches before the render cap. */
  total: number;
  /** True when `total` exceeds the render cap. */
  truncated: boolean;
}

export function filterModelOptions(
  models: readonly ModelOption[],
  query: string,
  activeId?: string,
): ModelPickerView {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? models.filter(
        (model) =>
          model.id.toLowerCase().includes(needle) ||
          model.label.toLowerCase().includes(needle),
      )
    : [...models];

  // With no search the active model stays at the top: a 9router catalog can
  // list hundreds of entries, and scrolling to find the one in use is noise.
  if (!needle && activeId) {
    const index = matches.findIndex((model) => model.id === activeId);
    if (index > 0) matches.unshift(...matches.splice(index, 1));
  }

  const total = matches.length;
  return {
    models: matches.slice(0, MODEL_PICKER_RENDER_LIMIT),
    total,
    truncated: total > MODEL_PICKER_RENDER_LIMIT,
  };
}
