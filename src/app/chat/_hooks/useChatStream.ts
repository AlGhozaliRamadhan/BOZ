import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { getEffort, getThinkingEnabled } from '@/shared/chat-options';
import type { ToolResult } from '@/shared/chat-tool-results';
import {
  buildPausedChatResponse,
  describeChatStreamFailure,
  type ChatStreamFailure,
} from '@/shared/chat-stream-failure';
import { buildAssistantMessageMetrics } from '../_lib/chat-message-metrics';
import { toolStartThought, updateToolResultThought } from '../_lib/tool-thoughts';
import type { ChatMessage } from '../_lib/chat-types';

type ChatStreamError = Error & ChatStreamFailure;

function streamFailureFromPayload(payload: unknown, status?: number): ChatStreamFailure {
  const candidate = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const message = typeof candidate.error === 'string'
    ? candidate.error
    : typeof candidate.message === 'string'
      ? candidate.message
      : undefined;

  return {
    status,
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message,
  };
}

function streamFailureFromError(error: unknown): ChatStreamFailure {
  if (!error || typeof error !== 'object') return {};
  const candidate = error as Partial<ChatStreamFailure> & { message?: unknown };
  return {
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
  };
}

function createChatStreamError(failure: ChatStreamFailure): ChatStreamError {
  const error = new Error(failure.message ?? 'Chat stream failed') as ChatStreamError;
  Object.assign(error, failure);
  return error;
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

  const abortControllerRef = useRef<AbortController | null>(null);

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

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const executeStreamChat = async (
    command: string,
    historyMessages: ChatMessage[],
    startedAt: number,
  ): Promise<ChatMessage> => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedContent = '';
    let accumulatedThoughts: string[] = [];
    const collectedTools: ToolResult[] = [];
    let firstTokenAt: number | undefined;

    const createReply = (content: string): ChatMessage => {
      const completedAt = Date.now();
      return {
        role: 'assistant',
        content,
        createdAt: completedAt,
        metrics: buildAssistantMessageMetrics({
          content,
          startedAt,
          firstTokenAt,
          completedAt,
          toolCount: collectedTools.filter(tool => tool.status === 'done').length,
        }),
        thoughts: accumulatedThoughts.length > 0 ? [...accumulatedThoughts] : undefined,
        tools: collectedTools.filter(tool => tool.status === 'done'),
      };
    };

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: command,
          history: historyMessages.map(({ role, content }) => ({ role, content })),
          effort: getEffort(),
          thinking: getThinkingEnabled(),
          model: activeModel || undefined,
        }),
      });

      if (!res.ok) {
        let payload: unknown;
        try { payload = await res.json(); } catch {}
        throw createChatStreamError(streamFailureFromPayload(payload, res.status));
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No readable stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (controller.signal.aborted) {
          try { await reader.cancel(); } catch {}
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (!dataStr) continue;

            if (currentEvent === 'token') {
              firstTokenAt ??= Date.now();
              let token: any = dataStr;
              try { token = JSON.parse(dataStr); } catch {}

              if (typeof token === 'string') {
                accumulatedContent += token.replace(/\\n/g, '\n');
              } else if (token && typeof token === 'object' && token.message) {
                accumulatedContent += token.message;
              } else {
                accumulatedContent += String(token);
              }
              setStreamingContent(accumulatedContent);
            } else if (currentEvent === 'tool_start') {
              try {
                const data = JSON.parse(dataStr);
                collectedTools.push({ tool: data.tool, status: 'running', args: data.args });
                setToolStatuses([...collectedTools]);
                accumulatedThoughts.push(toolStartThought(data.tool, data.args));
                setStreamingThoughts([...accumulatedThoughts]);
              } catch (e) {}
            } else if (currentEvent === 'tool_result') {
              try {
                const data = JSON.parse(dataStr);
                const idx = collectedTools.findIndex(t =>
                  t.tool === data.tool &&
                  t.status === 'running' &&
                  JSON.stringify(t.args ?? {}) === JSON.stringify(data.args ?? {}),
                );
                const next: ToolResult = {
                  tool: data.tool,
                  status: 'done',
                  fact: data.fact,
                  quality: data.quality,
                  success: data.success,
                  preview: data.preview,
                  detail: data.detail,
                  args: data.args ?? (idx !== -1 ? collectedTools[idx].args : undefined),
                };
                if (idx !== -1) collectedTools[idx] = next;
                else collectedTools.push(next);
                setToolStatuses([...collectedTools]);
                accumulatedThoughts.splice(
                  0,
                  accumulatedThoughts.length,
                  ...updateToolResultThought(accumulatedThoughts, {
                    tool: data.tool,
                    args: next.args,
                    fact: data.fact,
                  }),
                );
                setStreamingThoughts([...accumulatedThoughts]);
              } catch (e) {}
            } else if (currentEvent === 'thought_new') {
              try {
                let data = JSON.parse(dataStr);
                if (typeof data !== 'string') {
                  data = typeof data === 'object' && data.text ? data.text : JSON.stringify(data);
                }
                accumulatedThoughts.push(data);
                setStreamingThoughts([...accumulatedThoughts]);
              } catch {
                accumulatedThoughts.push(dataStr);
                setStreamingThoughts([...accumulatedThoughts]);
              }
            } else if (currentEvent === 'thought') {
              let dataText = dataStr;
              try {
                let parsed = JSON.parse(dataStr);
                if (typeof parsed !== 'string') {
                  parsed = typeof parsed === 'object' && parsed.text ? parsed.text : JSON.stringify(parsed);
                }
                dataText = parsed;
              } catch {}

              const lastIdx = accumulatedThoughts.length - 1;
              const lastItem = lastIdx >= 0 ? accumulatedThoughts[lastIdx] : null;
              const isLastItemToolOrHeader = lastItem && (
                lastItem.startsWith('tool used: ') ||
                lastItem.startsWith('• tool_call: ') ||
                lastItem.startsWith('Searched: ') ||
                lastItem.startsWith('Branching off:') ||
                lastItem.startsWith('Branches are in') ||
                lastItem.startsWith('Before answering')
              );

              if (accumulatedThoughts.length === 0 || isLastItemToolOrHeader) {
                accumulatedThoughts.push(dataText);
              } else {
                accumulatedThoughts[lastIdx] += dataText;
              }
              setStreamingThoughts([...accumulatedThoughts]);
            } else if (currentEvent === 'error') {
              let payload: unknown;
              try { payload = JSON.parse(dataStr); } catch { payload = { message: dataStr }; }
              throw createChatStreamError(streamFailureFromPayload(payload));
            }
          }
        }
      }

      if (controller.signal.aborted) {
        return createReply(accumulatedContent || '[Generation stopped]');
      }
      if (!accumulatedContent) {
        return createReply(buildPausedChatResponse({
          completedResearch: accumulatedThoughts.length > 0 || collectedTools.some(tool => tool.status === 'done'),
          failure: { message: 'The stream ended before the model sent a final response' },
        }));
      }
      return createReply(accumulatedContent);
    } catch (err: unknown) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return createReply(accumulatedContent || '[Generation stopped]');
      }
      return createReply(buildPausedChatResponse({
        partialContent: accumulatedContent,
        completedResearch: accumulatedThoughts.length > 0 || collectedTools.some(tool => tool.status === 'done'),
        failure: streamFailureFromError(err),
      }));
    } finally {
      abortControllerRef.current = null;
    }
  };

  const sendMessage = async (override?: string) => {
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

    let activeChatId = chatId;
    if (!activeChatId) {
      activeChatId = btoa(Date.now().toString() + Math.random().toString(36).substring(7)).replace(/=/g, '');
      persistSession(activeChatId, updatedMessages);
    } else {
      persistSession(activeChatId, updatedMessages);
    }

    try {
      const reply = await executeStreamChat(command, messages, sentAt);

      const finalMessages = [...updatedMessages, reply];
      setMessages(finalMessages);
      setStreamingContent('');
      setStreamingThoughts([]);
      setToolStatuses([]);
      persistSession(activeChatId, finalMessages);
      if (messages.length === 0) {
        void requestSessionTitle(activeChatId, [userMessage, reply], activeModel);
      }

    } catch (err) {
      const failure = streamFailureFromError(err);
      setError(describeChatStreamFailure(failure));
      const errMessages = [
        ...updatedMessages,
        {
          role: 'assistant',
          content: buildPausedChatResponse({ failure }),
          createdAt: Date.now(),
        } as ChatMessage,
      ];
      setMessages(errMessages);
      setStreamingContent('');
      setStreamingThoughts([]);
      setToolStatuses([]);
      persistSession(activeChatId, errMessages);
    } finally {
      setLoading(false);
      focusComposer();
      if (chatId !== activeChatId) {
        router.replace('/chat/' + activeChatId);
      }
    }
  };

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
  };
}
