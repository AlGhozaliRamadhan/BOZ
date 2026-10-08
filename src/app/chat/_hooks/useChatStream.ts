import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { getEffort, getThinkingEnabled } from '@/shared/chat-options';
import type { ToolResult } from '@/shared/chat-tool-results';
import {
  flushStreamProgress,
  getStreamSnapshot,
  isStreamActive,
  startStream,
  stopStream,
  subscribeToStream,
  type StreamSnapshot,
} from '../_lib/chat-stream-manager';
import { createSessionId, sessionNeedsTitle } from '../_lib/chat-ids';
import {
  announceSessionsChanged,
  defaultSessionStorage,
  readSession,
  readSessions,
  reconcileInterruptedSessions,
  writeSessions,
} from '../_lib/chat-sessions';
import type { ChatMessage } from '../_lib/chat-types';

/**
 * Title requests in flight, module scope so concurrent hook instances (Strict
 * Mode remounts, reattach races) never double-fire for one session. Entries
 * are always removed in a `finally`, so a failed request stays retryable.
 */
const inFlightTitleRequests = new Set<string>();

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
  const [stopping, setStopping] = useState(false);
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
  // Mirrors `stopping` state for idempotent stop clicks without impure updaters.
  const stoppingRef = useRef(false);
  // Failsafe: if a stop press never produces a terminal snapshot (hung
  // reader, missed notification), the UI still releases within seconds.
  // The manager settles the stream itself in the background.
  const stopFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStopFallback = () => {
    if (stopFallbackRef.current) {
      clearTimeout(stopFallbackRef.current);
      stopFallbackRef.current = null;
    }
  };

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /** Renders the persisted messages of `id` into hook state. */
  const refreshMessages = useCallback((id: string | undefined | null) => {
    if (typeof window === 'undefined') return;
    if (!id) {
      // Functional guards: a fresh `[]` is a new reference every time, so an
      // unconditional setMessages([]) re-renders even when already empty and
      // retriggers the attach effect -> "Maximum update depth exceeded" on /chat.
      setMessages((prev) => (prev.length === 0 ? prev : []));
      setStreamingContent((prev) => (prev === '' ? prev : ''));
      setStreamingThoughts((prev) => (prev.length === 0 ? prev : []));
      setToolStatuses((prev) => (prev.length === 0 ? prev : []));
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
      setStreamingContent((prev) => (prev === '' ? prev : ''));
      setStreamingThoughts((prev) => (prev.length === 0 ? prev : []));
      setToolStatuses((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    setStreamingContent(snapshot.content);
    setStreamingThoughts(snapshot.thoughts);
    setToolStatuses(snapshot.tools);
    setError(snapshot.status === 'error' ? snapshot.error : null);
    if (snapshot.status !== 'streaming') {
      clearStopFallback();
      stoppingRef.current = false;
      setStopping(false);
    }
  }, []);

  /**
   * Requests an AI title when the session still carries its placeholder
   * (first-user-message fallback). Need is derived from stored state, so a
   * request lost to failure, reload, or remount is retried on every later
   * finish until a generated title actually lands and the sidebar updates.
   */
  const requestTitleForSession = useCallback((id: string) => {
    try {
      const need = sessionNeedsTitle(defaultSessionStorage(), id);
      if (!need) return;
      if (inFlightTitleRequests.has(id)) return;
      inFlightTitleRequests.add(id);
      void Promise.resolve(
        requestSessionTitle(id, [need.user, need.assistant], activeModelRef.current),
      ).finally(() => {
        inFlightTitleRequests.delete(id);
      });
    } catch {
      // Title generation is best-effort.
    }
  }, [requestSessionTitle]);

  /** Titles a first exchange whose AI title was lost (e.g. finished in background). */
  const maybeGenerateMissingTitle = useCallback((id: string) => {
    requestTitleForSession(id);
  }, [requestTitleForSession]);

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
    if (loading && loadingType && loadingType.startsWith('/')) {
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
    clearStopFallback();
    stoppingRef.current = false;
    setStopping(false);
  }, [resetSignal]);

  // Safety net: a settled stream without a terminal snapshot (e.g. stop on
  // an already-finished session) must never leave "Stopping…" on screen.
  useEffect(() => {
    if (!loading && stoppingRef.current) {
      clearStopFallback();
      stoppingRef.current = false;
      setStopping(false);
    }
  }, [loading]);

  useEffect(() => () => {
    if (stopFallbackRef.current) clearTimeout(stopFallbackRef.current);
  }, []);

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
      // A background finish while unmounted still deserves an AI title.
      // Need is storage-derived, so this also retries titles lost earlier.
      if (targetId) {
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
      // Every finish re-checks: a still-untitled session gets its AI title
      // requested again until a generated title actually lands.
      maybeGenerateMissingTitle(observedId);
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
  // The button always responds: a live stream is aborted (idempotent —
  // repeat clicks are ignored), a dead spinner with no live stream is
  // healed at once, and a fallback releases the UI even if no terminal
  // snapshot ever arrives.
  const stopStreaming = useCallback(() => {
    const targetId = chatIdRef.current ?? pendingSessionRef.current;
    if (!targetId || !isStreamActive(targetId)) {
      clearStopFallback();
      stoppingRef.current = false;
      setStopping(false);
      setLoading(false);
      return false;
    }
    if (stoppingRef.current) return true;
    stoppingRef.current = true;
    const aborted = stopStream(targetId);
    if (!aborted) {
      stoppingRef.current = false;
      return false;
    }
    setStopping(true);
    clearStopFallback();
    stopFallbackRef.current = setTimeout(() => {
      stopFallbackRef.current = null;
      stoppingRef.current = false;
      setStopping(false);
      const current = chatIdRef.current ?? pendingSessionRef.current;
      if (current && !isStreamActive(current)) setLoading(false);
    }, 6000);
    return true;
  }, []);

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
    clearStopFallback();
    stoppingRef.current = false;
    setStopping(false);
    setLoadingStep(0);
    setLoadingType(command.toLowerCase());
    setError(null);

    // Persist the user message, then hand the generation to the module-level
    // stream manager. From here the reply survives unmount: progress is
    // persisted to the session store and this view reattaches on remount.
    let targetId = chatIdRef.current;
    try {
      if (!targetId) {
        targetId = createSessionId();
        pendingSessionRef.current = targetId;
        persistSession(targetId, updatedMessages);
        router.replace('/chat/' + targetId);
      } else {
        persistSession(targetId, updatedMessages);
      }

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
    clearStopFallback();
    stoppingRef.current = false;
    setStopping(false);
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
    stopping,
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
