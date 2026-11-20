'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import styles from './ChatComponent.module.css';
import Composer from './Composer';
import EmptyState from './EmptyState';
import MessageList from './MessageList';
import { useChatHistory } from '../_hooks/useChatHistory';
import { useChatStream } from '../_hooks/useChatStream';
import { useSetupState } from '../_hooks/useSetupState';
import {
  clearChatDraft,
  defaultDraftStorage,
  readChatDraft,
  writeChatDraft,
} from '../_lib/chat-draft';
import { getRandomGreeting, MARKET_QUOTES } from '../_lib/greetings';
import { takeChatPrefill } from '@/shared/discover';
import type { MarketQuote } from '../_lib/chat-types';
import { NEW_CHAT_EVENT } from '../_lib/chat-storage';
import { DEFAULT_PROFILE, PROFILE_EVENT, readProfile } from '@/app/components/layout/profile-state';

export default function ChatComponent({ chatId }: { chatId?: string }) {
  const { messages, setMessages, persistSession, requestSessionTitle, resetSignal } =
    useChatHistory(chatId);
  const { setup } = useSetupState();
  const [input, setInputState] = useState('');
  const [greeting, setGreeting] = useState('How can I help you today?');
  const [currentQuote, setCurrentQuote] = useState<MarketQuote | null>(null);

  // The composer is keyed by conversation, not by this component instance.
  // The draft store is the source of truth for unsent text: a remount (the
  // first send swaps /chat for /chat/<id>, replacing the page component) or a
  // host reload re-reads it instead of starting from an empty box.
  const chatIdRef = useRef<string | undefined>(chatId);
  chatIdRef.current = chatId;
  const inputRef = useRef('');
  // Distinguishes the first send (an id appears under text that belongs to
  // this new conversation) from switching between existing conversations
  // (the box should load that conversation's own draft).
  const previousChatIdRef = useRef<string | undefined>(chatId);

  const setInput = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    const next = typeof value === 'function'
      ? (value as (current: string) => string)(inputRef.current)
      : value;
    inputRef.current = next;
    setInputState(next);
    writeChatDraft(defaultDraftStorage(), chatIdRef.current, next);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const focusComposer = () => {
    textareaRef.current?.focus();
  };

  const {
    loading,
    stopping,
    error,
    setError,
    streamingContent,
    streamSteps,
    toolStatuses,
    streamRetry,
    reasoningActive,
    sendMessage,
    stopStreaming,
    retryLastGeneration,
    continueLastGeneration,
    showRetry,
    showContinue,
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

  // The greeting persona follows the profile display name, mirroring the
  // Sidebar's profile-state subscription. The ref keeps the random picks
  // fresh without coupling them to re-renders; a rename re-greets in place.
  const displayNameRef = useRef<string>('');
  useEffect(() => {
    const syncGreetingName = () => {
      let next: string;
      try {
        next = readProfile(window.localStorage).displayName;
      } catch {
        next = DEFAULT_PROFILE.displayName;
      }
      const previous = displayNameRef.current;
      displayNameRef.current = next;
      if (previous !== '' && previous !== next) {
        setGreeting(getRandomGreeting(next));
      }
    };
    syncGreetingName();
    window.addEventListener(PROFILE_EVENT, syncGreetingName);
    return () => window.removeEventListener(PROFILE_EVENT, syncGreetingName);
  }, []);

  useEffect(() => {
    setGreeting(getRandomGreeting(displayNameRef.current));
    setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
    // Restore what the user had typed in this conversation before they were
    // interrupted. The unsaved /chat composer has its own key, so starting a
    // new chat never inherits the previous conversation's draft.
    const previousChatId = previousChatIdRef.current;
    previousChatIdRef.current = chatId;
    // The first send turns /chat into /chat/<id>. Text typed while that request
    // was in flight belongs to the conversation that was just created, so it
    // carries over; reading the new key there would blank the box under the
    // user's cursor. Every other route change loads that conversation's draft.
    const createdConversation = previousChatId === undefined && chatId !== undefined;
    let draft = createdConversation
      ? inputRef.current
      : readChatDraft(defaultDraftStorage(), chatId);
    // Discover's agent strip stashes a one-shot prompt in sessionStorage.
    // Pick it up on fresh /chat so the user lands with their question ready.
    if (!chatId) {
      try {
        const prefill = takeChatPrefill(window.sessionStorage);
        if (prefill) draft = prefill;
      } catch {
        // Prefill is best-effort.
      }
    }
    inputRef.current = draft;
    setInputState(draft);
    // Writing here also persists a prefill (or the carried-over text) under the
    // current key, so a route change mid-edit cannot strand it.
    if (draft) writeChatDraft(defaultDraftStorage(), chatId, draft);
  }, [chatId]);

  useEffect(() => {
    const handleNewChat = () => {
      setInput('');
      // A fresh chat should not resurrect text left in the unsaved composer
      // from an earlier visit to /chat.
      clearChatDraft(defaultDraftStorage(), undefined);
      setGreeting(getRandomGreeting(displayNameRef.current));
      setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
      textareaRef.current?.focus();
    };
    window.addEventListener(NEW_CHAT_EVENT, handleNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, handleNewChat);
  }, [setInput]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  const scrollToBottom = () => {
    try {
      const el = messagesEndRef.current;
      // The anchor only exists while the message list is mounted; during the
      // EmptyState ↔ list switch it is detached and scrolling must be skipped.
      if (!el || !el.isConnected) return;
      el.scrollIntoView({ behavior: 'smooth' });
    } catch {
      // Smooth scrolling is best-effort and must never break the chat view.
    }
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
            <EmptyState
              greeting={greeting}
              quote={currentQuote}
              onSuggest={sendMessage}
              setup={setup}
              onOpenSettings={() => {
                window.dispatchEvent(new CustomEvent('boz_open_settings', { detail: { tab: 'providers' } }));
              }}
            />
          ) : (
            <MessageList
              messages={messages}
              loading={loading}
              stopping={stopping}
              streamingContent={streamingContent}
              streamingSteps={streamSteps}
              toolStatuses={toolStatuses}
              onSendCommand={sendMessage}
              endRef={messagesEndRef}
              showRetry={showRetry}
              onRetry={retryLastGeneration}
              showContinue={showContinue}
              onContinue={continueLastGeneration}
              streamRetry={streamRetry}
              reasoningActive={reasoningActive}
            />
          )}
        </div>

        <Composer
          input={input}
          setInput={setInput}
          loading={loading}
          stopping={stopping}
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
