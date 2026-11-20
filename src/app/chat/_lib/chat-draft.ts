// ─── chat/_lib/chat-draft.ts ────────────────────────────────────────────────
// Unsent composer text, stored per conversation.
//
// The composer's text used to live only in ChatComponent's `useState`, which
// made it a property of that component instance rather than of the
// conversation. Any remount dropped it — and the first send deliberately swaps
// the `/chat` page for `/chat/<id>`, so the page component is replaced
// mid-run — and any host reload took it too. The result was the reported
// failure: the user is part-way through a paragraph while the answer they are
// reacting to is still arriving, and the paragraph disappears under them.
//
// sessionStorage rather than localStorage: a draft belongs to the conversation
// it was written in and to this sitting. It should survive a remount or a
// reload, not reappear days later in a different browser session.
//
// Storage is injected (the same pattern as chat-sessions.ts) so this stays
// testable outside a browser.

export const CHAT_DRAFT_PREFIX = 'boz_chat_draft:';

/** Key for a conversation; an unsaved `/chat` composer has no id yet. */
export function chatDraftKey(chatId?: string): string {
  return `${CHAT_DRAFT_PREFIX}${chatId && chatId.length > 0 ? chatId : 'new'}`;
}

export interface ChatDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(): ChatDraftStorage {
  const store: Record<string, string> = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
    removeItem: (key) => {
      delete store[key];
    },
  };
}

let fallbackStorage: ChatDraftStorage | null = null;

export function defaultDraftStorage(): ChatDraftStorage {
  if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  if (!fallbackStorage) fallbackStorage = memoryStorage();
  return fallbackStorage;
}

export function readChatDraft(storage: ChatDraftStorage, chatId?: string): string {
  try {
    return storage.getItem(chatDraftKey(chatId)) ?? '';
  } catch {
    // A disabled storage area costs the safety net, never the composer.
    return '';
  }
}

/**
 * Persists the draft. Empty text is a delete, not an empty record, so a sent
 * message cannot be resurrected by a later remount reading a stale key.
 */
export function writeChatDraft(
  storage: ChatDraftStorage,
  chatId: string | undefined,
  text: string,
): void {
  try {
    if (text) storage.setItem(chatDraftKey(chatId), text);
    else storage.removeItem(chatDraftKey(chatId));
  } catch {
    // Quota or a disabled storage area: typing must keep working regardless.
  }
}

export function clearChatDraft(storage: ChatDraftStorage, chatId?: string): void {
  writeChatDraft(storage, chatId, '');
}
