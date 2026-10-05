import { useEffect, useState } from 'react';
import type { ChatMessage } from '../_lib/chat-types';
import {
  NEW_CHAT_EVENT,
  readChatSessions,
  saveChatSession,
  saveGeneratedChatTitle,
} from '../_lib/chat-storage';

export function useChatHistory(chatId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    if (chatId) {
      const sessions = readChatSessions();
      const session = sessions.find(s => s.id === chatId);
      if (session) {
        setMessages(session.messages);
      }
    } else {
      setMessages([]);
    }
  }, [chatId]);

  useEffect(() => {
    const handleNewChat = () => {
      setMessages([]);
      setResetSignal(s => s + 1);
    };
    window.addEventListener(NEW_CHAT_EVENT, handleNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, handleNewChat);
  }, []);

  const persistSession = (id: string, msgs: ChatMessage[]) => {
    saveChatSession(id, msgs);
  };

  const requestSessionTitle = async (
    id: string,
    titleMessages: ChatMessage[],
    model?: string,
  ) => {
    try {
      const response = await fetch('/api/chat/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: titleMessages.map(({ role, content }) => ({ role, content: content.slice(0, 4_000) })),
          model: model || undefined,
        }),
      });
      if (!response.ok) return;

      const data: unknown = await response.json();
      const title = data && typeof data === 'object' ? (data as { title?: unknown }).title : null;
      saveGeneratedChatTitle(id, title);
    } catch {
      // Keep the first-message title when a background title request fails.
    }
  };

  return { messages, setMessages, persistSession, requestSessionTitle, resetSignal };
}
