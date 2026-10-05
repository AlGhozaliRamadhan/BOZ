'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './ChatComponent.module.css';
import Composer from './Composer';
import EmptyState from './EmptyState';
import MessageList from './MessageList';
import { useChatHistory } from '../_hooks/useChatHistory';
import { useChatStream } from '../_hooks/useChatStream';
import { getRandomGreeting, MARKET_QUOTES } from '../_lib/greetings';
import type { MarketQuote } from '../_lib/chat-types';
import { NEW_CHAT_EVENT } from '../_lib/chat-storage';

export default function ChatComponent({ chatId }: { chatId?: string }) {
  const { messages, setMessages, persistSession, requestSessionTitle, resetSignal } =
    useChatHistory(chatId);
  const [input, setInput] = useState('');
  const [greeting, setGreeting] = useState('How can I help you today?');
  const [currentQuote, setCurrentQuote] = useState<MarketQuote | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const focusComposer = () => {
    textareaRef.current?.focus();
  };

  const {
    loading,
    error,
    setError,
    streamingContent,
    streamingThoughts,
    toolStatuses,
    sendMessage,
    stopStreaming,
  } = useChatStream({
    chatId,
    messages,
    setMessages,
    input,
    setInput,
    persistSession,
    requestSessionTitle,
    focusComposer,
    resetSignal,
  });

  useEffect(() => {
    setGreeting(getRandomGreeting());
    setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
  }, []);

  useEffect(() => {
    const handleNewChat = () => {
      setInput('');
      setGreeting(getRandomGreeting());
      setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
      textareaRef.current?.focus();
    };
    window.addEventListener(NEW_CHAT_EVENT, handleNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, handleNewChat);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className={`${styles['chat-page-root']} animate-fadeIn`}>
      <div className={styles['chat-container']}>
        {/* Messages */}
        <div className={styles['chat-messages']}>
          {messages.length === 0 && !loading ? (
            <EmptyState greeting={greeting} quote={currentQuote} onSuggest={sendMessage} />
          ) : (
            <MessageList
              messages={messages}
              loading={loading}
              streamingContent={streamingContent}
              streamingThoughts={streamingThoughts}
              toolStatuses={toolStatuses}
              onSendCommand={sendMessage}
              endRef={messagesEndRef}
            />
          )}
        </div>

        <Composer
          input={input}
          setInput={setInput}
          loading={loading}
          onSend={() => sendMessage()}
          onStop={stopStreaming}
          textareaRef={textareaRef}
        />
      </div>

      {/* Error toast */}
      {error && (
        <div className="toast-container">
          <div className="toast error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
