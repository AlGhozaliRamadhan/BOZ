export const FALLBACK_CHAT_TITLE = 'New Chat';
export const MAX_CHAT_TITLE_LENGTH = 60;

function truncateTitle(title: string): string {
  const characters = Array.from(title);
  if (characters.length <= MAX_CHAT_TITLE_LENGTH) return title;
  return `${characters.slice(0, MAX_CHAT_TITLE_LENGTH - 1).join('')}…`;
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Uses the first user message until an AI-generated title is available. */
export function fallbackChatTitle(firstUserMessage?: string): string {
  const title = firstUserMessage ? cleanTitle(firstUserMessage) : '';
  return title ? truncateTitle(title) : FALLBACK_CHAT_TITLE;
}

/** Normalizes model output before it is persisted and displayed in the chat history. */
export function normalizeGeneratedChatTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const title = cleanTitle(value)
    .replace(/^(?:chat\s*)?title\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.…]+$/, '')
    .trim();

  return title ? truncateTitle(title) : null;
}

/**
 * Makes a chat title unique against existing history titles (case-insensitive).
 * Keeps the base when free, otherwise appends ` (2)`, ` (3)`, … while staying
 * within `maxLength` so the sidebar never shows two identical rows.
 */
export function ensureUniqueChatTitle(
  base: string,
  existing: readonly string[],
  maxLength: number = MAX_CHAT_TITLE_LENGTH,
): string {
  const taken = new Set(existing.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const cleanBase = cleanTitle(base) || FALLBACK_CHAT_TITLE;
  const candidate = truncateTitle(cleanBase);
  if (!taken.has(candidate.toLowerCase())) return candidate;

  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const room = Math.max(0, maxLength - suffix.length);
    const shortened = Array.from(cleanBase).slice(0, room).join('').trimEnd();
    const next = `${shortened}${suffix}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return candidate;
}
