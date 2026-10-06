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
    .trim();

  return title ? truncateTitle(title) : null;
}
