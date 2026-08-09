// ─── shared/chat-options.ts ───────────────────────────────────────────────────
// Single source of truth for the chat request knobs: thinking effort
// (Low/Medium/High/Extra/Max) and the extended-thinking (Deep Think) toggle.
// Browser-only — every access is guarded so this module is SSR-safe.

export const EFFORT_OPTIONS = ['Low', 'Medium', 'High', 'Extra', 'Max'] as const;
export type Effort = (typeof EFFORT_OPTIONS)[number];

// Reuse the existing key so no migration is needed for current users.
export const EFFORT_STORAGE_KEY = 'boz_thinking_effort';
export const THINKING_STORAGE_KEY = 'boz_thinking_enabled';

export const DEFAULT_EFFORT: Effort = 'Medium';
export const DEFAULT_THINKING = true;

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

export function getThinkingEnabled(): boolean {
  if (typeof window === 'undefined') return DEFAULT_THINKING;
  const raw = localStorage.getItem(THINKING_STORAGE_KEY);
  return raw === null ? DEFAULT_THINKING : raw !== 'false';
}

export function setThinkingEnabled(value: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THINKING_STORAGE_KEY, String(value));
  notify();
}
