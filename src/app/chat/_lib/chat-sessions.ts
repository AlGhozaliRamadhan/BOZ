// ─── chat/_lib/chat-sessions.ts ─────────────────────────────────────────────
// Status-aware session store: local persistence for chat sessions, including
// per-message generation status so the recent-chat list can show whether a
// reply finished or not. Shares the `boz_chat_sessions` key (and JSON shape)
// with chat-storage.ts; `status` is optional so plain writes stay compatible.
// Storage helpers take an explicit storage handle (default: window.localStorage)
// so they stay testable; browser event announces are SSR-guarded.

import {
  buildPausedChatResponse,
} from '@/shared/chat-stream-failure';
import {
  canTransitionChatStatus,
  isChatGenerationStatus,
  rollupChatStatus,
  type ChatGenerationStatus,
} from '@/shared/chat-generation-status';
import type { AssistantMessageMetrics } from './chat-message-metrics';
import type { ToolResult } from '@/shared/chat-tool-results';
import type { ChatMessage, ChatSession } from './chat-types';

export const CHAT_SESSIONS_KEY = 'boz_chat_sessions';
export const CHAT_UPDATED_EVENT = 'boz_chat_updated';

export interface ChatSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function memoryStorage(): ChatSessionStorage {
  const store: Record<string, string> = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

let fallbackStorage: ChatSessionStorage | null = null;

export function defaultSessionStorage(): ChatSessionStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (!fallbackStorage) fallbackStorage = memoryStorage();
  return fallbackStorage;
}

export function sanitizeSessionId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  // Accepts the current safe alphabet plus legacy base64 output (`+/=`).
  return /^[A-Za-z0-9_+/=.-]+$/.test(id) ? id : null;
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.role !== 'user' && candidate.role !== 'assistant') return null;
  if (typeof candidate.content !== 'string') return null;
  const message: ChatMessage = { role: candidate.role, content: candidate.content };
  if (Number.isFinite(candidate.createdAt)) message.createdAt = candidate.createdAt as number;
  if (candidate.metrics && typeof candidate.metrics === 'object') {
    message.metrics = candidate.metrics as AssistantMessageMetrics;
  }
  if (candidate.data !== undefined) message.data = candidate.data;
  if (
    candidate.type === 'intraday' ||
    candidate.type === 'longterm' ||
    candidate.type === 'newsintel' ||
    candidate.type === 'chat'
  ) {
    message.type = candidate.type;
  }
  if (Array.isArray(candidate.thoughts)) message.thoughts = candidate.thoughts.filter((t): t is string => typeof t === 'string');
  if (Array.isArray(candidate.tools)) message.tools = candidate.tools as ToolResult[];
  if (Array.isArray(candidate.suggestions)) message.suggestions = candidate.suggestions as ChatMessage['suggestions'];
  if (isChatGenerationStatus(candidate.status)) message.status = candidate.status;
  return message;
}

function sanitizeSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const id = sanitizeSessionId(candidate.id);
  if (!id || typeof candidate.title !== 'string') return null;
  if (!Array.isArray(candidate.messages)) return null;
  const messages = candidate.messages
    .map(sanitizeMessage)
    .filter((m): m is ChatMessage => m !== null);
  const session: ChatSession = {
    id,
    title: candidate.title,
    messages,
    updatedAt: Number(candidate.updatedAt) || 0,
  };
  if (isChatGenerationStatus(candidate.status)) session.status = candidate.status;
  return withRolledUpStatus(session);
}

export function readSessions(storage: ChatSessionStorage = defaultSessionStorage()): ChatSession[] {
  try {
    const stored = storage.getItem(CHAT_SESSIONS_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSession)
      .filter((s): s is ChatSession => s !== null);
  } catch {
    return [];
  }
}

export function readSession(
  storage: ChatSessionStorage = defaultSessionStorage(),
  id: string,
): ChatSession | null {
  return readSessions(storage).find((session) => session.id === id) ?? null;
}

export function writeSessions(
  storage: ChatSessionStorage = defaultSessionStorage(),
  sessions: ChatSession[],
): void {
  try {
    storage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Session persistence is best-effort and must never break the chat UI.
  }
}

export function announceSessionsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
  }
}

/** Preferred session status: the cached rollup, recomputed when absent. */
export function getSessionStatus(session: ChatSession): ChatGenerationStatus {
  return session.status ?? rollupChatStatus(session.messages);
}

export function withRolledUpStatus(session: ChatSession): ChatSession {
  return { ...session, status: rollupChatStatus(session.messages) };
}

function cloneSession(session: ChatSession): ChatSession {
  return { ...session, messages: session.messages.map((m) => ({ ...m })) };
}

/**
 * Inserts or replaces a session, stamps updatedAt, refreshes the rollup,
 * persists, and announces. Returns the stored copy.
 */
export function upsertSession(
  storage: ChatSessionStorage = defaultSessionStorage(),
  session: ChatSession,
  announce = true,
): ChatSession {
  const sessions = readSessions(storage);
  const stored: ChatSession = withRolledUpStatus({
    ...cloneSession(session),
    updatedAt: Date.now(),
  });
  const index = sessions.findIndex((s) => s.id === stored.id);
  if (index >= 0) sessions[index] = stored;
  else sessions.push(stored);
  writeSessions(storage, sessions);
  if (announce) announceSessionsChanged();
  return stored;
}

/** Appends an assistant message and returns its index. No-op when missing. */
export function appendAssistantMessage(
  storage: ChatSessionStorage = defaultSessionStorage(),
  sessionId: string,
  message: ChatMessage,
  announce = true,
): number {
  const sessions = readSessions(storage);
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index < 0) return -1;
  const session = cloneSession(sessions[index]);
  session.messages.push({ ...message });
  sessions[index] = withRolledUpStatus({ ...session, updatedAt: Date.now() });
  writeSessions(storage, sessions);
  if (announce) announceSessionsChanged();
  return session.messages.length - 1;
}

export interface AssistantMessagePatch {
  content?: string;
  thoughts?: string[];
  tools?: ToolResult[];
  metrics?: AssistantMessageMetrics;
  status?: ChatGenerationStatus;
}

/**
 * Patches the assistant message at `messageIndex`. Status writes honor the
 * transition guards (terminal states never leave terminal). Returns false
 * when the session or message is missing.
 */
export function patchAssistantMessage(
  storage: ChatSessionStorage = defaultSessionStorage(),
  sessionId: string,
  messageIndex: number,
  patch: AssistantMessagePatch,
  announce = true,
): boolean {
  const sessions = readSessions(storage);
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index < 0) return false;
  const session = cloneSession(sessions[index]);
  const message = session.messages[messageIndex];
  if (!message || message.role !== 'assistant') return false;
  if (patch.status !== undefined && !canTransitionChatStatus(message.status, patch.status)) {
    return false;
  }
  const next: ChatMessage = { ...message };
  if (patch.content !== undefined) next.content = patch.content;
  if (patch.thoughts !== undefined) next.thoughts = [...patch.thoughts];
  if (patch.tools !== undefined) next.tools = [...patch.tools];
  if (patch.metrics !== undefined) next.metrics = patch.metrics;
  if (patch.status !== undefined) next.status = patch.status;
  session.messages[messageIndex] = next;
  sessions[index] = withRolledUpStatus({ ...session, updatedAt: Date.now() });
  writeSessions(storage, sessions);
  if (announce) announceSessionsChanged();
  return true;
}

export interface ReconcileResult {
  sessions: ChatSession[];
  changed: boolean;
}

/**
 * Marks orphaned generations as `interrupted`: sessions whose rollup is still
 * `streaming` but that have no live runner (`isActive` returns false). This
 * covers real app quits and reloads, where the sidecar dies with the server
 * and no generation can complete. Idempotent — safe to run on every launch.
 */
export function reconcileInterruptedSessions(
  sessions: ChatSession[],
  isActive: (sessionId: string) => boolean,
  now: number = Date.now(),
): ReconcileResult {
  let changed = false;
  const next = sessions.map((raw) => {
    const session = cloneSession(raw);
    if (getSessionStatus(session) !== 'streaming' || isActive(session.id)) {
      return withRolledUpStatus(session);
    }
    changed = true;
    const last = session.messages[session.messages.length - 1];
    if (!last || last.role === 'user') {
      session.messages.push({
        role: 'assistant',
        content: buildPausedChatResponse({ failure: { code: 'connection_interrupted' } }),
        createdAt: now,
        status: 'interrupted',
      });
    } else if (canTransitionChatStatus(last.status, 'interrupted')) {
      session.messages[session.messages.length - 1] = { ...last, status: 'interrupted' };
    }
    session.updatedAt = now;
    return withRolledUpStatus(session);
  });
  return { sessions: next, changed };
}
