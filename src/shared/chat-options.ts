// ─── shared/chat-options.ts ───────────────────────────────────────────────────
// Single source of truth for the chat request knob: thinking effort
// (Low/Medium/High/Extra/Max). The old extended-thinking (Deep Think) toggle
// lived beside it and was removed — it replicated what the tiers already
// encode, so the effort tier alone now governs both the pass count and the
// model's own reasoning budget.
// Browser-only — every access is guarded so this module is SSR-safe.

export const EFFORT_OPTIONS = ['Low', 'Medium', 'High', 'Extra', 'Max'] as const;
export type Effort = (typeof EFFORT_OPTIONS)[number];

// Reuse the existing key so no migration is needed for current users.
export const EFFORT_STORAGE_KEY = 'boz_thinking_effort';

export const DEFAULT_EFFORT: Effort = 'Medium';

export const CHAT_OPTIONS_EVENT = 'boz_chat_options_changed';

function notify(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHAT_OPTIONS_EVENT));
  }
}

export function getEffort(): Effort {
  if (typeof window === 'undefined') return DEFAULT_EFFORT;
  const raw = localStorage.getItem(EFFORT_STORAGE_KEY);
  return EFFORT_OPTIONS.includes(raw as Effort) ? (raw as Effort) : DEFAULT_EFFORT;
}

export function setEffort(value: Effort): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(EFFORT_STORAGE_KEY, value);
  notify();
}
