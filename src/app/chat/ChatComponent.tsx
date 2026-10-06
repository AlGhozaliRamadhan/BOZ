'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { ThoughtAccordion } from '../components/ui/ThoughtAccordion';
import styles from './ChatComponent.module.css';
import composerStyles from './Composer.module.css';
import { getEffort, getThinkingEnabled } from '../../shared/chat-options';
import ChatModelPicker from './ChatModelPicker';
import ChatEffortPicker from './ChatEffortPicker';
import ChatRiskPicker from './ChatRiskPicker';
import type { ToolResult } from './ToolResultCards';
import {
  formatDuration,
  formatTokensPerSecond,
  type AssistantMessageMetrics,
} from './chat-message-metrics';
import { fallbackChatTitle, normalizeGeneratedChatTitle } from './chat-title';
import {
  flushStreamProgress,
  getStreamSnapshot,
  isStreamActive,
  startStream,
  stopStream,
  subscribeToStream,
  type StreamSnapshot,
} from './chat-stream-manager';
import {
  announceSessionsChanged,
  defaultSessionStorage,
  readSession,
  readSessions,
  reconcileInterruptedSessions,
  upsertSession,
  writeSessions,
} from './chat-sessions';
import type { ChatGenerationStatus } from '@/shared/chat-generation-status';

export interface TickerSuggestion {
  symbol: string;
  name: string;
  exchange?: string;
  command?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: number;
  metrics?: AssistantMessageMetrics;
  data?: any;
  type?: 'intraday' | 'longterm' | 'newsintel' | 'chat';
  thoughts?: string[];
  tools?: ToolResult[];
  suggestions?: TickerSuggestion[];
  status?: ChatGenerationStatus;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  status?: ChatGenerationStatus;
}

function formatContent(content: string): string {
  try {
    const rawHtml = marked.parse(content, { breaks: true, async: false }) as string;
    return DOMPurify.sanitize(rawHtml);
  } catch (e) {
    return DOMPurify.sanitize(content);
  }
}

function formatMessageTime(timestamp?: number): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

interface MarketQuote {
  text: string;
  author: string;
}

/** New-session ids use the same alphabet the session store sanitizer accepts. */
function createSessionId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `chat-${Date.now().toString(36)}-${random}`;
}

const MARKET_QUOTES: MarketQuote[] = [
  { text: "Risk comes from not knowing what you are doing.", author: "Warren Buffett" },
  { text: "In trading, you have to be defensive. If you have a bad trade, cut it quickly before it hurts.", author: "Paul Tudor Jones" },
  { text: "The stock market is a device to transfer money from the impatient to the patient.", author: "Benjamin Graham" },
  { text: "It is not whether you are right or wrong, but how much money you make when you are right and how much you lose when you are wrong.", author: "George Soros" },
  { text: "The trend is your friend until the end when it bends.", author: "Ed Seykota" },
  { text: "Markets can remain irrational longer than you can remain solvent.", author: "John Maynard Keynes" },
  { text: "The four most dangerous words in investing are: 'This time it's different.'", author: "Sir John Templeton" },
  { text: "Cut your losses short and let your winners run.", author: "Jesse Livermore" },
  { text: "The goal of a successful trader is to make the best trades. Money is secondary.", author: "Alexander Elder" },
  { text: "Rule No. 1: Never lose money. Rule No. 2: Never forget rule No. 1.", author: "Warren Buffett" },
  { text: "In investing, what is comfortable is rarely profitable.", author: "Robert Arnott" },
  { text: "Know what you own, and know why you own it.", author: "Peter Lynch" },
  { text: "The elements of good trading are: 1. Cutting losses, 2. Cutting losses, and 3. Cutting losses.", author: "Ed Seykota" },
  { text: "The stock market does not know you own it.", author: "Warren Buffett" },
  { text: "Win or lose, everybody gets what they want out of the market.", author: "Ed Seykota" },
  { text: "If you cannot control your emotions, you cannot control your money.", author: "Warren Buffett" },
  { text: "Price is what you pay. Value is what you get.", author: "Warren Buffett" },
  { text: "Wide diversification is only required when investors do not understand what they are doing.", author: "Warren Buffett" },
  { text: "Opportunities come infrequently. When it rains gold, put out the bucket, not the thimble.", author: "Warren Buffett" },
  { text: "The big money is not in the buying and the selling, but in the waiting.", author: "Charlie Munger" },
  { text: "It is remarkable how much long-term advantage people like us have gotten by trying to be consistently not stupid, instead of trying to be very intelligent.", author: "Charlie Munger" },
  { text: "In the short run, the market is a voting machine, but in the long run, it is a weighing machine.", author: "Benjamin Graham" },
  { text: "Behind every stock is a company. Find out what it's doing.", author: "Peter Lynch" },
  { text: "Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it.", author: "Peter Lynch" },
  { text: "You get recessions, you have stock market declines. If you don't understand that's going to happen, then you're not ready, you won't do well in the markets.", author: "Peter Lynch" },
  { text: "Losers average losers.", author: "Paul Tudor Jones" },
  { text: "I'm always thinking about losing money as opposed to making money. Don't focus on making money, focus on protecting what you have.", author: "Paul Tudor Jones" },
  { text: "Markets are constantly in a state of uncertainty and flux, and money is made by discounting the obvious and betting on the unexpected.", author: "George Soros" },
  { text: "There is nothing new in Wall Street. Whatever happens in the stock market today has happened before and will happen again.", author: "Jesse Livermore" },
  { text: "It was never my thinking that made the big money for me. It also was my sitting. Got that? My sitting tight!", author: "Jesse Livermore" },
  { text: "A loss never bothers me after I take it. I forget it overnight. But being wrong — not taking the loss — that is what does the damage to the pocketbook and to the soul.", author: "Jesse Livermore" },
  { text: "If you don't find a way to make money while you sleep, you will work until you die.", author: "Warren Buffett" },
  { text: "The desire for constant action irrespective of underlying conditions is responsible for many losses on Wall Street.", author: "Jesse Livermore" },
  { text: "I just wait until there is money lying in the corner, and all I have to do is go over there and pick it up. I do nothing in the meantime.", author: "Jim Rogers" },
  { text: "Do not anticipate and move without market confirmation — being a little late in your trade is your insurance that your judgment is correct.", author: "Jesse Livermore" },
  { text: "The market is a harsh teacher because she gives the test first, the lesson afterward.", author: "Vernon Law" },
  { text: "The secret to being successful from a trading perspective is to have an indefatigable and undying and unquenchable thirst for information and knowledge.", author: "Paul Tudor Jones" },
  { text: "Investing should be more like watching paint dry or watching grass grow. If you want excitement, take $800 and go to Las Vegas.", author: "Paul Samuelson" },
  { text: "The individual investor should act consistently as an investor and not as a speculator.", author: "Benjamin Graham" },
  { text: "Bull markets are born on pessimism, grow on skepticism, mature on optimism and die on euphoria.", author: "Sir John Templeton" },
  { text: "The most important quality for an investor is temperament, not intellect.", author: "Warren Buffett" },
  { text: "If you are shopping for common stocks, chose them the way you would buy groceries, not the way you would buy perfume.", author: "Benjamin Graham" },
  { text: "All you need is one good idea to make a lot of money.", author: "Charlie Munger" },
  { text: "It takes 20 years to build a reputation and five minutes to ruin it. If you think about that, you'll do things differently.", author: "Warren Buffett" },
  { text: "I have two basic rules about winning in trading as well as in life: 1. If you don't bet, you can't win. 2. If you lose all your chips, you can't bet.", author: "Larry Hite" },
  { text: "Whenever I get hit in the market, I get the hell out. It doesn't matter where the market is trading.", author: "Marty Schwartz" },
  { text: "Learn to take losses. The most important thing in making money is not letting your losses get out of hand.", author: "Marty Schwartz" },
  { text: "I always define my risk, and I don't have to worry about it.", author: "Tony Saliba" },
  { text: "The key to trading success is emotional discipline. If intelligence were the key, there would be a lot more people making money.", author: "Victor Sperandeo" },
  { text: "Amateurs think about how much money they can make. Professionals think about how much money they could lose.", author: "Mark Douglas" },
  { text: "When you genuinely accept the risks, you will be at peace with any outcome.", author: "Mark Douglas" },
  { text: "The market does not know you exist. You can do nothing to influence it. You can only control your behavior.", author: "Mark Douglas" },
  { text: "I believe in both technical analysis and fundamentals. But the charts tell the story before the fundamentals do.", author: "Dan Zanger" },
  { text: "The whole secret to winning in the stock market is to lose the least amount possible when you're not right.", author: "William O'Neil" },
  { text: "Letting your losses run is the most serious mistake made by most investors.", author: "William O'Neil" },
  { text: "It is crucial to have a plan for selling before you buy.", author: "Mark Minervini" },
  { text: "Expectancy is everything: win rate multiplied by average win minus loss rate multiplied by average loss.", author: "Mark Minervini" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "Compound interest is the eighth wonder of the world. He who understands it, earns it; he who doesn't, pays it.", author: "Albert Einstein" },
  { text: "Spend each day trying to be a little wiser than you were when you woke up.", author: "Charlie Munger" }
];

const getRandomGreeting = (): string => {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 12) {
    const morning = [
      'Good morning, User',
      'Ready for the opening bell?',
      'Rise and analyze, User',
      'Good morning! Let\'s check the tape'
    ];
    return morning[Math.floor(Math.random() * morning.length)];
  } else if (hour >= 12 && hour < 17) {
    const noon = [
      'Good afternoon, User',
      'Midday market check-in',
      'Active session underway, User',
      'Good afternoon! What are we scanning?'
    ];
    return noon[Math.floor(Math.random() * noon.length)];
  } else if (hour >= 17 && hour < 22) {
    const evening = [
      'Good evening, User',
      'Evening debrief & analysis',
      'Good evening! Reviewing today\'s action',
      'Market wrap & research session'
    ];
    return evening[Math.floor(Math.random() * evening.length)];
  } else {
    const night = [
      'Burning the midnight oil?',
      'Late night research mode, User',
      'Good night, User',
      'Overnight global market scan'
    ];
    return night[Math.floor(Math.random() * night.length)];
  }
};

export default function ChatComponent({ chatId }: { chatId?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThoughts, setStreamingThoughts] = useState<string[]>([]);
  const [toolStatuses, setToolStatuses] = useState<ToolResult[]>([]);
  const [activeModel, setActiveModel] = useState('');
  const [greeting, setGreeting] = useState('How can I help you today?');
  const [currentQuote, setCurrentQuote] = useState<MarketQuote | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef<string | undefined>(chatId);
  chatIdRef.current = chatId;

  // Id minted for a fresh chat before the route updates to /chat/[id].
  // Lets stop + reattach logic target the right session during the gap.
  const pendingSessionRef = useRef<string | null>(null);
  // Sessions whose first exchange just finished and still need an AI title.
  const needsTitleRef = useRef<Set<string>>(new Set());

  /** Renders the persisted messages of `id` into component state. */
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
      if (session && id === chatIdRef.current) {
        setMessages(session.messages);
      }
    } catch (e) {
      console.error('Failed to load chat session', e);
    }
  }, []);

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

  useEffect(() => {
    setGreeting(getRandomGreeting());
    setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
  }, []);

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
    const handleNewChat = () => {
      setMessages([]);
      setStreamingContent('');
      setStreamingThoughts([]);
      setToolStatuses([]);
      setError(null);
      setInput('');
      setGreeting(getRandomGreeting());
      setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
      textareaRef.current?.focus();
    };
    window.addEventListener('boz_new_chat', handleNewChat);
    return () => window.removeEventListener('boz_new_chat', handleNewChat);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  const saveSession = (id: string, msgs: ChatMessage[]) => {
    // Persists through the session store so every view (chat, sidebar)
    // observes the same messages + generation status. Saving never touches
    // the manager-owned stream — it must not interrupt a generation.
    try {
      const storage = defaultSessionStorage();
      const existing = readSession(storage, id);
      const title = fallbackChatTitle(msgs.find((m) => m.role === 'user')?.content);
      upsertSession(storage, {
        id,
        title: existing?.title || title,
        messages: msgs,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error('Failed to save session', e);
    }
  };

  const saveGeneratedSessionTitle = (id: string, candidate: unknown) => {
    const title = normalizeGeneratedChatTitle(candidate);
    if (!title) return;

    try {
      const storage = defaultSessionStorage();
      const sessions = readSessions(storage);
      const index = sessions.findIndex((session) => session.id === id);
      if (index < 0) return;

      // Title-only write: preserves messages, status, and updatedAt ordering.
      sessions[index] = { ...sessions[index], title };
      writeSessions(storage, sessions);
      announceSessionsChanged();
    } catch (error) {
      console.error('Failed to save generated chat title', error);
    }
  };

  const generateSessionTitle = async (id: string, titleMessages: ChatMessage[]) => {
    try {
      const response = await fetch('/api/chat/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: titleMessages.map(({ role, content }) => ({ role, content: content.slice(0, 4_000) })),
          model: activeModel || undefined,
        }),
      });
      if (!response.ok) return;

      const data: unknown = await response.json();
      const title = data && typeof data === 'object' ? (data as { title?: unknown }).title : null;
      saveGeneratedSessionTitle(id, title);
    } catch {
      // Keep the first-message title when a background title request fails.
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
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
      void generateSessionTitle(id, [userMessage, assistantMessage]);
    } catch {
      // Title generation is best-effort.
    }
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
      if (targetId && needsTitleRef.current.delete(targetId)) {
        maybeGenerateMissingTitle(targetId);
      } else if (targetId) {
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
            void generateSessionTitle(observedId, [userMessage, assistantMessage]);
          }
        }
      } else {
        // Background finish without a live needsTitle entry (unmounted when
        // the first exchange completed) still deserves an AI title.
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
    const userMessage: ChatMessage = { role: 'user', content: command, createdAt: sentAt };
    const updatedMessages = [...messages, userMessage];
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
    const isFirstExchange = messages.length === 0;
    try {
      if (!targetId) {
        targetId = createSessionId();
        pendingSessionRef.current = targetId;
        saveSession(targetId, updatedMessages);
        router.replace('/chat/' + targetId);
      } else {
        saveSession(targetId, updatedMessages);
      }
      if (isFirstExchange) needsTitleRef.current.add(targetId);

      const history = messages.map(({ role, content }) => ({ role, content }));
      const started = startStream({
        sessionId: targetId,
        command,
        history,
        effort: getEffort(),
        thinking: getThinkingEnabled(),
        model: activeModel || undefined,
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
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading) {
        sendMessage();
      }
    }
  };

  /** Re-issues the last user prompt after an error/interrupt (terminal states never auto-resume). */
  const retryLastGeneration = useCallback(() => {
    const targetId = chatIdRef.current ?? pendingSessionRef.current;
    if (!targetId || loading || isStreamActive(targetId)) return;
    const session = readSession(defaultSessionStorage(), targetId);
    const thread = session?.messages ?? messages;
    const lastUserIndex = [...thread].map((m) => m.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    const command = thread[lastUserIndex].content;
    const history = thread.slice(0, lastUserIndex).map(({ role, content }) => ({ role, content }));
    const startedAt = Date.now();
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
        model: activeModel || undefined,
        startedAt,
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
  }, [loading, messages, activeModel, applySnapshot]);

  // While a background generation is live, the persisted trailing placeholder
  // (partial content, status streaming) would double-render with the live
  // bubble. Hide it from the list; the bubble is the source of truth.
  const displayMessages =
    loading && messages.length > 0
      ? (() => {
          const last = messages[messages.length - 1];
          if (last.role === 'assistant' && last.status === 'streaming') {
            return messages.slice(0, -1);
          }
          return messages;
        })()
      : messages;
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showRetry =
    !loading &&
    !!lastMessage &&
    lastMessage.role === 'assistant' &&
    (lastMessage.status === 'error' || lastMessage.status === 'interrupted') &&
    !(chatIdRef.current && isStreamActive(chatIdRef.current));



  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className={`${styles['chat-page-root']} animate-fadeIn`}>
      <div className={styles['chat-container']}>
        {/* Messages */}
        <div className={styles['chat-messages']}>
            {displayMessages.length === 0 && !loading ? (
              <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                  <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: '16px' }} />
                </div>
                <h2 className={styles['chat-empty-title']}>{greeting}</h2>

                {currentQuote && (
                  <div className={`${styles['chat-empty-quote']} animate-fadeIn`}>
                    &ldquo;{currentQuote.text}&rdquo;
                    <span className={styles['chat-empty-quote-author']}> — {currentQuote.author}</span>
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '640px' }}>
                  {[
                    { text: 'Global Market Outlook', action: 'What is the current global market outlook across equities, bonds, and macro regimes?' },
                    { text: 'Intraday NVDA', action: '/intraday NVDA' },
                    { text: 'Scan IDX Momentum', action: 'Scan Indonesia stocks for high-probability momentum and breakout candidates' },
                    { text: 'Market News Intel', action: '/newsintel' },
                    { text: 'Longterm AAPL', action: '/longterm AAPL' },
                    { text: 'Crypto & Bitcoin Status', action: 'What is the current Bitcoin price action and crypto crowd sentiment?' },
                  ].map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => sendMessage(s.action)}
                      className={styles['suggestion-chip']}
                    >
                      {s.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {displayMessages.map((msg, i) => (
                  <div key={i} className={`${styles['chat-bubble']} ${msg.role}`}>
                    {msg.role === 'assistant' ? (
                      <div className="flex-row gap-3" style={{ width: '100%' }}>
                        <div className={styles['chat-assistant-avatar']} style={{ flexShrink: 0, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                        </div>
                        <div style={{ width: '100%', paddingTop: '2px' }}>
                          {msg.thoughts && msg.thoughts.length > 0 && (
                            <ThoughtAccordion
                              thoughts={msg.thoughts}
                              toolResults={msg.tools}
                              title="Thought process"
                              defaultOpen={false}
                            />
                          )}
                          {msg.content && (
                            <div dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
                          )}

                          {/* Ticker Typo Clarification Suggestions */}
                          {msg.suggestions && msg.suggestions.length > 0 && (
                            <div className={styles['chat-suggestion-group']}>
                              <div className={styles['chat-suggestion-label']}>Suggested Tickers:</div>
                              <div className={styles['chat-suggestion-cards']}>
                                {msg.suggestions.map((s, si) => (
                                  <button
                                    key={si}
                                    type="button"
                                    className={styles['chat-suggestion-card']}
                                    onClick={() => sendMessage(s.command || `/intraday ${s.symbol}`)}
                                    title={`Run analysis for ${s.symbol}`}
                                  >
                                    <div className={styles['chat-suggestion-card-main']}>
                                      <span className={styles['chat-suggestion-symbol']}>{s.symbol}</span>
                                      <span className={styles['chat-suggestion-name']}>{s.name}</span>
                                    </div>
                                    {s.exchange && <span className={styles['chat-suggestion-exchange']}>{s.exchange}</span>}
                                    <i className={`fa-solid fa-arrow-right ${styles['chat-suggestion-arrow']}`}></i>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Assistant Message Actions */}
                          {msg.content && (
                            <div className={styles['chat-message-footer']}>
                              <div className={styles['chat-message-meta']}>
                                {formatMessageTime(msg.createdAt) && (
                                  <span title={new Date(msg.createdAt!).toLocaleString()}>
                                    <i className="fa-regular fa-clock"></i>
                                    {formatMessageTime(msg.createdAt)}
                                  </span>
                                )}
                                {msg.metrics && (
                                  <>
                                    <span title="Estimated visible output tokens; exact provider usage is not available for every model.">
                                      ~{msg.metrics.outputTokensEstimate} tokens
                                    </span>
                                    <span>{msg.metrics.outputWords} words</span>
                                    <span title="Total time from sending the prompt until the reply completed.">
                                      {formatDuration(msg.metrics.totalDurationMs)} total
                                    </span>
                                    {msg.metrics.timeToFirstTokenMs !== undefined && (
                                      <span title="Time from sending the prompt until the first visible response token.">
                                        first {formatDuration(msg.metrics.timeToFirstTokenMs)}
                                      </span>
                                    )}
                                    {formatTokensPerSecond(msg.metrics.outputTokensPerSecond) && (
                                      <span title="Estimated visible output tokens per second after the first visible token.">
                                        {formatTokensPerSecond(msg.metrics.outputTokensPerSecond)}
                                      </span>
                                    )}
                                    {msg.metrics.toolCount > 0 && (
                                      <span>{msg.metrics.toolCount} tool{msg.metrics.toolCount === 1 ? '' : 's'}</span>
                                    )}
                                  </>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => copyMessage(msg.content, i)}
                                className={styles['chat-copy-btn']}
                                title="Copy response to clipboard"
                              >
                                <i className={copiedIndex === i ? 'fa-solid fa-check' : 'fa-regular fa-copy'} style={{ fontSize: '11px' }}></i>
                                <span>{copiedIndex === i ? 'Copied!' : 'Copy'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={styles['chat-user-message']}>
                        <span>{msg.content}</span>
                        {formatMessageTime(msg.createdAt) && (
                          <time dateTime={new Date(msg.createdAt!).toISOString()} className={styles['chat-user-time']}>
                            Sent {formatMessageTime(msg.createdAt)}
                          </time>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator — streaming assistant response */}
                {loading && (
                  <div className={`${styles['chat-bubble']} assistant`}>
                    <div className="flex-row gap-3" style={{ width: '100%' }}>
                      <div className={styles['chat-assistant-avatar']} style={{ flexShrink: 0, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                      </div>
                      <div style={{ width: '100%', paddingTop: '2px' }}>
                        {streamingThoughts.length > 0 && (
                          <ThoughtAccordion
                            thoughts={streamingThoughts}
                            toolResults={toolStatuses}
                            isStreaming={true}
                            defaultOpen={false}
                            title="Thought process"
                          />
                        )}
                        {streamingContent ? (
                          <div dangerouslySetInnerHTML={{ __html: formatContent(streamingContent) }} />
                        ) : streamingThoughts.length > 0 ? null : (
                          <div className="flex-row gap-2 items-center" style={{ height: '28px' }}>
                            <span className="spinner spinner-sm"></span>
                            <span className="page-subtitle animate-fadeIn" style={{ margin: 0, transition: 'all 0.3s ease' }}>
                              Thinking...
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Retry affordance — terminal error/interrupt never auto-resumes. */}
                {showRetry && (
                  <div className={`${styles['chat-bubble']} assistant`}>
                    <div className="flex-row gap-3" style={{ width: '100%' }}>
                      <div style={{ width: '100%' }}>
                        <div className="page-subtitle" style={{ margin: '0 0 8px' }}>
                          {lastMessage?.status === 'interrupted'
                            ? 'Generation was interrupted (app closed or reloaded). Partial progress is saved.'
                            : 'Generation hit an error. Partial progress is saved.'}
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={retryLastGeneration}
                        >
                          <i className="fa-solid fa-rotate-right"></i>
                          <span>Retry generation</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input Area (Claude-style composer) */}
          <div className={composerStyles['chat-composer']}>
            {input.startsWith('/') && !input.includes(' ') && input !== '/newsintel' && (
              <div className={composerStyles['chat-slash-menu']} role="listbox" aria-label="Commands">
                {[
                  { cmd: '/intraday ', title: 'Intraday', desc: 'Live intraday analysis & key levels [ticker]', icon: 'fa-chart-line' },
                  { cmd: '/longterm ', title: 'Longterm', desc: 'Fundamental analysis & long-term outlook [ticker]', icon: 'fa-scale-balanced' },
                  { cmd: '/newsintel', title: '/newsintel', desc: 'Scan latest market headlines', icon: 'fa-newspaper' }
                ].filter(c => c.cmd.startsWith(input) || c.title.startsWith(input)).map(item => (
                  <button 
                    key={item.cmd}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => { setInput(item.cmd); textareaRef.current?.focus(); }}
                    className={composerStyles['chat-slash-item']}
                  >
                    <span className={composerStyles['chat-slash-item-icon']}>
                      <i className={`fa-solid ${item.icon}`}></i>
                    </span>
                    <span className={composerStyles['chat-slash-item-text']}>
                      <span className={composerStyles['chat-slash-item-title']}>{item.title}</span>
                      <span className={composerStyles['chat-slash-item-desc']}>{item.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              className={composerStyles['chat-composer-textarea']}
              placeholder="Write a message or type '/' for commands..."
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />

            <div className={composerStyles['chat-composer-footer']}>
              <div className={composerStyles['chat-composer-footer-left']}>
                <button
                  type="button"
                  className={composerStyles['chat-composer-action-btn']}
                  onClick={() => {
                    setInput((prev) => (prev ? prev : '/'));
                    textareaRef.current?.focus();
                  }}
                  title="Commands & tools"
                  aria-label="Commands"
                >
                  <i className="fa-solid fa-plus" style={{ fontSize: '12px' }}></i>
                </button>
              </div>

              <div className={composerStyles['chat-composer-footer-right']}>
                <ChatEffortPicker />
                <ChatRiskPicker />
                <ChatModelPicker />
                <button
                  type="button"
                  className={`${composerStyles['chat-composer-send-btn']} ${loading ? 'active is-stop' : input.trim() ? 'active' : ''}`}
                  onClick={() => {
                    if (loading) {
                      stopStreaming();
                    } else {
                      sendMessage();
                    }
                  }}
                  disabled={!loading && !input.trim()}
                  title={loading ? 'Stop generation' : 'Send message (Enter)'}
                  aria-label={loading ? 'Stop generation' : 'Send message'}
                >
                  {loading ? (
                    <i className="fa-solid fa-stop" style={{ fontSize: '12px' }}></i>
                  ) : (
                    <i className="fa-solid fa-arrow-up" style={{ fontSize: '13px' }}></i>
                  )}
                </button>
              </div>
            </div>
          </div>
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
