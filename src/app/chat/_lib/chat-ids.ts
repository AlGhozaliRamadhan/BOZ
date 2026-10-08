// ─── chat/_lib/chat-ids.ts ────────────────────────────────────────────────────
// Session identity helpers. Pure module: no `use client`, no DOM — safe to
// import anywhere (hooks, tests).
//
// New-session ids are UUID v4 (`6e691a5d-6c9f-4389-bbfd-5618bb6c0e5c`), so the
// address bar shows an opaque id like mainstream AI chats instead of a
// timestamp-derived string. Legacy `chat-<base36>-<rand>` ids keep working:
// the session store matches by exact id and its sanitizer accepts both
// alphabets, so no migration is needed.

import { FALLBACK_CHAT_TITLE, fallbackChatTitle } from '@/shared/chat-title';
import { readSessions, type ChatSessionStorage } from './chat-sessions';
import type { ChatMessage } from './chat-types';

export const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Mints a UUID v4 session id. Uses Web Crypto only (never Math.random): ids
 * route sessions, so CodeQL treats them as a security context.
 */
export function createSessionId(): string {
  const cryptoRef: Crypto | undefined =
    typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  if (!cryptoRef || typeof cryptoRef.getRandomValues !== 'function') {
    throw new Error('Web Crypto is unavailable: cannot mint a session id');
  }
  const bytes = new Uint8Array(16);
  cryptoRef.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

export interface TitleNeed {
  user: ChatMessage;
  assistant: ChatMessage;
}

/**
 * Returns the messages to title with when a session still carries its
 * placeholder title (first-user-message fallback or "New Chat"), else null.
 * Derived from stored state — never from ephemeral refs — so a title request
 * lost to a failure, reload, or remount is retried until a generated title
 * actually lands. Only a completed (or legacy status-less) assistant message
 * qualifies; partial, errored, and interrupted replies never define a title.
 */
export function sessionNeedsTitle(
  storage: ChatSessionStorage,
  id: string,
): TitleNeed | null {
  let session;
  try {
    session = readSessions(storage).find((s) => s.id === id) ?? null;
  } catch {
    return null;
  }
  if (!session || session.messages.length === 0) return null;
  const user = session.messages.find((m) => m.role === 'user') ?? null;
  if (!user) return null;
  const isUntitled =
    session.title === FALLBACK_CHAT_TITLE ||
    session.title === fallbackChatTitle(user.content);
  if (!isUntitled) return null;
  const assistant =
    [...session.messages]
      .reverse()
      .find(
        (m) =>
          m.role === 'assistant' &&
          (m.status === 'done' || m.status === undefined),
      ) ?? null;
  if (!assistant) return null;
  return { user, assistant };
}
