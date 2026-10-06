import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { getEffort, getThinkingEnabled } from '@/shared/chat-options';
import type { ToolResult } from '@/shared/chat-tool-results';
import { fallbackChatTitle } from '@/shared/chat-title';
import {
  flushStreamProgress,
  getStreamSnapshot,
  isStreamActive,
  startStream,
  stopStream,
  subscribeToStream,
  type StreamSnapshot,
} from '../_lib/chat-stream-manager';
import {
  announceSessionsChanged,
  defaultSessionStorage,
  readSession,
  readSessions,
  reconcileInterruptedSessions,
  writeSessions,
} from '../_lib/chat-sessions';
import type { ChatMessage } from '../_lib/chat-types';

/** New-session ids use the same alphabet the session store sanitizer accepts. */
function createSessionId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `chat-${Date.now().toString(36)}-${random}`;
}

interface UseChatStreamArgs {
  chatId?: string;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  input: string;
  setInput: (value: string) => void;
  persistSession: (id: string, msgs: ChatMessage[]) => void;
  requestSessionTitle: (id: string, msgs: ChatMessage[], model: string) => void;
  focusComposer: () => void;
  resetSignal: number;
}

export function useChatStream({
  chatId,
  messages,
  setMessages,
  input,
  setInput,
  persistSession,
  requestSessionTitle,
  focusComposer,
  resetSignal,
}: UseChatStreamArgs) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThoughts, setStreamingThoughts] = useState<string[]>([]);
  const [toolStatuses, setToolStatuses] = useState<ToolResult[]>([]);
  const [activeModel, setActiveModel] = useState('');

  const chatIdRef = useRef<string | undefined>(chatId);
  chatIdRef.current = chatId;
  const activeModelRef = useRef('');
  activeModelRef.current = activeModel;

  // Id minted for a fresh chat before the route updates to /chat/[id].
  // Lets stop + reattach logic target the right session during the gap.
  const pendingSessionRef = useRef<string | null>(null);
  // Sessions whose first exchange just finished and still need an AI title.
  const needsTitleRef = useRef<Set<string>>(new Set());

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /** Renders the persisted messages of `id` into hook state. */
  const refreshMessages = useCallback((id: string | undefined | null) => {
    if (typeof window === 'undefined') return;
    if (!id) {
      setMessages([]);
      setStreamingContent('');
      setStreamingThoughts([]);
      setToolStatuses([]);
      return;
    }
    try {
      const session = readSession(defaultSessionStorage(), id);
      if (session && id === (chatIdRef.current ?? pendingSessionRef.current)) {
        setMessages(session.messages);
      }
    } catch (e) {
      console.error('Failed to load chat session', e);
    }
  }, [setMessages]);

  /** Mirrors a manager snapshot into local render state. */
  const applySnapshot = useCallback((snapshot: StreamSnapshot | null) => {
    if (!snapshot) {
      setStreamingContent('');
      setStreamingThoughts([]);
      setToolStatuses([]);
      return;
    }
    setStreamingContent(snapshot.content);
    setStreamingThoughts(snapshot.thoughts);
    setToolStatuses(snapshot.tools);
    setError(snapshot.status === 'error' ? snapshot.error : null);
  }, []);

  /** Titles a first exchange whose AI title was lost (e.g. finished in background). */
  const maybeGenerateMissingTitle = useCallback((id: string) => {
    try {
      const done = readSession(defaultSessionStorage(), id);
      if (!done || done.messages.length !== 2) return;
      const userMessage = done.messages.find((m) => m.role === 'user');
      const assistantMessage = done.messages.find((m) => m.role === 'assistant');
      if (!userMessage || !assistantMessage) return;
      if (assistantMessage.status !== 'done') return;
      if (done.title !== fallbackChatTitle(userMessage.content)) return;
      requestSessionTitle(id, [userMessage, assistantMessage], activeModelRef.current);
    } catch {
      // Title generation is best-effort.
    }
  }, [requestSessionTitle]);

  const loadingMessages = [
    "Fetching real-time market data...",
    "Scanning social sentiment on Reddit and StockTwits...",
    "Calculating technical indicators and moving averages...",
    "Analyzing macro environment and Treasury yields...",
    "Waiting for AI models to synthesize response...",
    "Finalizing trading strategy..."
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading && loadingType && (loadingType.startsWith('/intraday') || loadingType.startsWith('/longterm'))) {
      interval = setInterval(() => {
        setLoadingStep((prev) => Math.min(prev + 1, loadingMessages.length - 1));
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [loading, loadingType]);

  useEffect(() => {
    setStreamingContent('');
    setStreamingThoughts([]);
    setToolStatuses([]);
    setError(null);
  }, [resetSignal]);

  useEffect(() => {
    const loadModel = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        setActiveModel(data.model || '');
      } catch {
        // keep last known model
      }
    };
    loadModel();
    window.addEventListener('boz_settings_updated', loadModel);
    return () => window.removeEventListener('boz_settings_updated', loadModel);
  }, []);

  // Attaches this view to the manager-owned stream for the current session.
  // Navigation only drops this subscription — the stream keeps running in the
  // background, persists progress, and finishes on its own. Returning
  // reattaches to the live snapshot or the persisted result. Cleanup
  // unsubscribes; it must NEVER abort (only the stop button aborts).
  useEffect(() => {
    if (chatId) pendingSessionRef.current = null;
    const targetId = chatId ?? pendingSessionRef.current;
    if (typeof window === 'undefined') return undefined;

    // Real app quits / reloads leave streaming rows with no live runner.
    // Reconcile is idempotent and skips every session with a live stream.
    try {
      const storage = defaultSessionStorage();
      const reconciled = reconcileInterruptedSessions(readSessions(storage), isStreamActive);
      if (reconciled.changed) {
        writeSessions(storage, reconciled.sessions);
        announceSessionsChanged();
      }
    } catch {
      // Reconciliation is best-effort; the view still renders below.
    }

    refreshMessages(targetId);
    const live = targetId ? getStreamSnapshot(targetId) : null;
    applySnapshot(live);
    setLoading(live?.status === 'streaming');
    if (live && live.status !== 'streaming') {
      refreshMessages(targetId);
      // A background finish without a live needsTitle entry (unmounted when
      // the first exchange completed) still deserves an AI title.
      if (targetId) {
        needsTitleRef.current.delete(targetId);
        maybeGenerateMissingTitle(targetId);
      }
    }

    if (!targetId) return undefined;
    const observedId = targetId;
    const flushOnHide = () => {
      flushStreamProgress(observedId);
    };
    window.addEventListener('pagehide', flushOnHide);
    document.addEventListener('visibilitychange', flushOnHide);
    const unsubscribe = subscribeToStream(observedId, (next) => {
      if (observedId !== (chatIdRef.current ?? pendingSessionRef.current)) return;
      applySnapshot(next);
      setLoading(next.status === 'streaming');
      if (next.status === 'streaming') return;
      refreshMessages(observedId);
      if (needsTitleRef.current.delete(observedId)) {
        const done = readSession(defaultSessionStorage(), observedId);
        if (done) {
          const reversed = [...done.messages].reverse();
          const userMessage = reversed.find((m) => m.role === 'user');
          const assistantMessage = reversed.find((m) => m.role === 'assistant');
          if (userMessage && assistantMessage) {
            requestSessionTitle(observedId, [userMessage, assistantMessage], activeModelRef.current);
          }
        }
      } else {
        maybeGenerateMissingTitle(observedId);
      }
    });
    return () => {
      window.removeEventListener('pagehide', flushOnHide);
      document.removeEventListener('visibilitychange', flushOnHide);
      unsubscribe();
    };
  }, [chatId, refreshMessages, applySnapshot, maybeGenerateMissingTitle]);

  // Only the stop button aborts a generation. Unmounting (dashboard
  // navigation, accidental exit) merely drops the UI subscription — the
  // manager-owned stream keeps running and finishes on its own.
  const stopStreaming = () => {
    const targetId = chatIdRef.current ?? pendingSessionRef.current;
    if (targetId) stopStream(targetId);
  };

  const sendMessage = async (override?: string) => {
    // Manager state is the single-flight source of truth, not view-local
    // loading: a remounted view can have loading=false while a background
    // generation is still running. Never persist a second user turn while
    // streaming — just reattach to the live snapshot.
    const liveTarget = chatIdRef.current ?? pendingSessionRef.current;
    if (liveTarget && isStreamActive(liveTarget)) {
      const snapshot = getStreamSnapshot(liveTarget);
      applySnapshot(snapshot);
      setLoading(snapshot?.status === 'streaming');
      return;
    }
    if (loading) return;
    if (!override && !input.trim()) return;

    const command = (override ?? input).trim();
    const sentAt = Date.now();
    const thread = messagesRef.current;
    const userMessage: ChatMessage = { role: 'user', content: command, createdAt: sentAt };
    const updatedMessages = [...thread, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setLoadingStep(0);
    setLoadingType(command.toLowerCase());
    setError(null);

    // Persist the user message, then hand the generation to the module-level
    // stream manager. From here the reply survives unmount: progress is
    // persisted to the session store and this view reattaches on remount.
    let targetId = chatIdRef.current;
    const isFirstExchange = thread.length === 0;
    try {
      if (!targetId) {
        targetId = createSessionId();
        pendingSessionRef.current = targetId;
        persistSession(targetId, updatedMessages);
        router.replace('/chat/' + targetId);
      } else {
        persistSession(targetId, updatedMessages);
      }
      if (isFirstExchange) needsTitleRef.current.add(targetId);

      const history = thread.map(({ role, content }) => ({ role, content }));
      const started = startStream({
        sessionId: targetId,
        command,
        history,
        effort: getEffort(),
        thinking: getThinkingEnabled(),
        model: activeModelRef.current || undefined,
        startedAt: sentAt,
      });
      if (!started) {
        // A generation is already running for this session — just attach to it.
        const snapshot = getStreamSnapshot(targetId);
        applySnapshot(snapshot);
        setLoading(snapshot?.status === 'streaming');
      }
    } catch (err) {
      console.error('Failed to start chat generation', err);
      setLoading(false);
      if (targetId) needsTitleRef.current.delete(targetId);
    } finally {
      focusComposer();
    }
  };

  /** Re-issues the last user prompt after an error/interrupt (terminal states never auto-resume). */
  const retryLastGeneration = useCallback(() => {
    const targetId = chatIdRef.current ?? pendingSessionRef.current;
    if (!targetId || isStreamActive(targetId)) return;
    const session = readSession(defaultSessionStorage(), targetId);
    const thread = session?.messages ?? messagesRef.current;
    const lastUserIndex = [...thread].map((m) => m.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    const command = thread[lastUserIndex].content;
    const history = thread.slice(0, lastUserIndex).map(({ role, content }) => ({ role, content }));
    setLoading(true);
    setLoadingStep(0);
    setLoadingType(command.toLowerCase());
    setError(null);
    try {
      const started = startStream({
        sessionId: targetId,
        command,
        history,
        effort: getEffort(),
        thinking: getThinkingEnabled(),
        model: activeModelRef.current || undefined,
        startedAt: Date.now(),
      });
      if (!started) {
        const snapshot = getStreamSnapshot(targetId);
        applySnapshot(snapshot);
        setLoading(snapshot?.status === 'streaming');
      }
    } catch (err) {
      console.error('Failed to retry chat generation', err);
      setLoading(false);
    }
  }, [applySnapshot]);

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showRetry =
    !loading &&
    !!lastMessage &&
    lastMessage.role === 'assistant' &&
    (lastMessage.status === 'error' || lastMessage.status === 'interrupted') &&
    !(chatIdRef.current && isStreamActive(chatIdRef.current));

  return {
    loading,
    error,
    setError,
    loadingStep,
    loadingType,
    streamingContent,
    streamingThoughts,
    toolStatuses,
    activeModel,
    sendMessage,
    stopStreaming,
    retryLastGeneration,
    showRetry,
  };
}
