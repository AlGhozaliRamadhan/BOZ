import { fallbackChatTitle, normalizeGeneratedChatTitle } from '@/shared/chat-title';
import type { ChatMessage, ChatSession } from './chat-types';

export const CHAT_SESSIONS_STORAGE_KEY = 'boz_chat_sessions';
export const CHAT_UPDATED_EVENT = 'boz_chat_updated';
export const NEW_CHAT_EVENT = 'boz_new_chat';

export function readChatSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as ChatSession[]) : [];
  } catch (error) {
    console.error('Failed to load chat session', error);
    return [];
  }
}

export function writeChatSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    // Dispatch an event so sidebar can update
    window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
  } catch (error) {
    console.error('Failed to save session', error);
  }
}

export function saveChatSession(id: string, msgs: ChatMessage[]): void {
  try {
    const stored = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
    const sessions: ChatSession[] = stored ? JSON.parse(stored) : [];
    const index = sessions.findIndex(s => s.id === id);
    const title = fallbackChatTitle(msgs.find(m => m.role === 'user')?.content);

    if (index >= 0) {
      sessions[index].messages = msgs;
      sessions[index].updatedAt = Date.now();
      sessions[index].title ||= title;
    } else {
      sessions.push({ id, title, messages: msgs, updatedAt: Date.now() });
    }
    localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    // Dispatch an event so sidebar can update
    window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
  } catch (e) {
    console.error('Failed to save session', e);
  }
}

export function saveGeneratedChatTitle(id: string, candidate: unknown): void {
  const title = normalizeGeneratedChatTitle(candidate);
  if (!title) return;

  try {
    const stored = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
    const sessions: ChatSession[] = stored ? JSON.parse(stored) : [];
    const index = sessions.findIndex(session => session.id === id);
    if (index < 0) return;

    sessions[index].title = title;
    localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
  } catch (error) {
    console.error('Failed to save generated chat title', error);
  }
}
