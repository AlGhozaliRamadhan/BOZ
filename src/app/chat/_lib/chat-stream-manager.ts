// ─── chat/_lib/chat-stream-manager.ts ───────────────────────────────────────
// Module-level owner of in-flight chat generations. The fetch + SSE reader live
// here instead of in hook/component state, so navigating to the dashboard (which
// unmounts the chat view) only drops the UI subscription — the stream keeps
// running, persists progress to the session store, and finishes on its own.
// Components subscribe to render live progress and reattach on remount.
//
// Only the stop button aborts a stream (user cancel). Unmount never aborts.
//
// Client-only: uses fetch and the session store (window.localStorage).

import { buildAssistantMessageMetrics } from './chat-message-metrics';
import {
  appendAssistantMessage,
  defaultSessionStorage,
  patchAssistantMessage,
} from './chat-sessions';
import type { ChatMessage } from './chat-types';
import { toolStartThought, updateToolResultThought } from './tool-thoughts';
import {
  buildPausedChatResponse,
  describeChatStreamFailure,
  type ChatStreamFailure,
} from '@/shared/chat-stream-failure';
import type { ToolResult } from '@/shared/chat-tool-results';

export type StreamSnapshotStatus = 'streaming' | 'done' | 'error' | 'cancelled';

export interface StreamSnapshot {
  status: StreamSnapshotStatus;
  content: string;
  thoughts: string[];
  tools: ToolResult[];
  error: string | null;
}

export interface StreamRequest {
  sessionId: string;
  command: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  effort: string;
  thinking: boolean;
  model?: string;
  startedAt: number;
}

type SnapshotListener = (snapshot: StreamSnapshot) => void;

interface ActiveStream {
  controller: AbortController;
  settled: Promise<void>;
  resolveSettled: () => void;
  snapshot: StreamSnapshot;
  listeners: Set<SnapshotListener>;
  messageIndex: number;
  startedAt: number;
  firstTokenAt?: number;
  accumulatedThoughts: string[];
  collectedTools: ToolResult[];
  lastPersistedAt: number;
}

const activeStreams = new Map<string, ActiveStream>();

/** Persist progress at most this often; completion always persists. */
const PERSIST_THROTTLE_MS = 1500;

export function isStreamActive(sessionId: string): boolean {
  return activeStreams.has(sessionId);
}

export function getStreamSnapshot(sessionId: string): StreamSnapshot | null {
  return activeStreams.get(sessionId)?.snapshot ?? null;
}

/** Resolves when the stream for `sessionId` settles (or immediately when none). */
export function waitForStream(sessionId: string): Promise<void> {
  return activeStreams.get(sessionId)?.settled ?? Promise.resolve();
}

/**
 * Attaches a listener to the live stream for `sessionId`. The listener fires
 * immediately with the current snapshot so a remounted component renders
 * accumulated progress at once. Unmounting must only unsubscribe — never abort.
 */
export function subscribeToStream(sessionId: string, listener: SnapshotListener): () => void {
  const handle = activeStreams.get(sessionId);
  if (!handle) return () => {};
  handle.listeners.add(listener);
  listener({ ...handle.snapshot, thoughts: [...handle.snapshot.thoughts], tools: [...handle.snapshot.tools] });
  return () => {
    handle.listeners.delete(listener);
  };
}

/** User-initiated cancel. Returns false when nothing was running. */
export function stopStream(sessionId: string): boolean {
  const handle = activeStreams.get(sessionId);
  if (!handle) return false;
  handle.controller.abort();
  return true;
}

/**
 * Best-effort flush of the latest accumulated progress to the session store.
 * Safe to call from `pagehide` / `visibilitychange`: forces a persist without
 * changing status, so a reload loses at most the in-flight SSE chunk.
 */
export function flushStreamProgress(sessionId: string): boolean {
  const handle = activeStreams.get(sessionId);
  if (!handle) return false;
  persistProgress(sessionId, handle, true);
  return true;
}

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

function notify(handle: ActiveStream): void {
  const snapshot: StreamSnapshot = {
    ...handle.snapshot,
    thoughts: [...handle.snapshot.thoughts],
    tools: [...handle.snapshot.tools],
  };
  for (const listener of handle.listeners) {
    try {
      listener(snapshot);
    } catch {
      // A broken listener must never break the stream.
    }
  }
}

function persistProgress(
  sessionId: string,
  handle: ActiveStream,
  force: boolean,
): void {
  const now = Date.now();
  if (!force && now - handle.lastPersistedAt < PERSIST_THROTTLE_MS) return;
  handle.lastPersistedAt = now;
  try {
    patchAssistantMessage(defaultSessionStorage(), sessionId, handle.messageIndex, {
      content: handle.snapshot.content,
      thoughts: [...handle.snapshot.thoughts],
      tools: [...handle.snapshot.tools],
    });
  } catch {
    // Persistence is best-effort; the in-memory snapshot keeps streaming.
  }
}

/**
 * Starts a generation for `sessionId`. Appends a `streaming` assistant
 * placeholder to the session first so the recent-chat list shows the pending
 * state immediately. Returns false when a stream is already running for the
 * session or the placeholder could not be created.
 */
export function startStream(request: StreamRequest): boolean {
  const { sessionId, command, history, effort, thinking, model, startedAt } = request;
  if (activeStreams.has(sessionId)) return false;

  let messageIndex: number;
  try {
    messageIndex = appendAssistantMessage(
      defaultSessionStorage(),
      sessionId,
      { role: 'assistant', content: '', createdAt: startedAt, status: 'streaming' },
    );
  } catch {
    return false;
  }
  if (messageIndex < 0) return false;

  const controller = new AbortController();
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const handle: ActiveStream = {
    controller,
    settled,
    resolveSettled,
    snapshot: { status: 'streaming', content: '', thoughts: [], tools: [], error: null },
    listeners: new Set(),
    messageIndex,
    startedAt,
    firstTokenAt: undefined,
    accumulatedThoughts: [],
    collectedTools: [],
    lastPersistedAt: Date.now(),
  };
  activeStreams.set(sessionId, handle);

  void runStream(sessionId, handle, { command, history, effort, thinking, model });
  return true;
}

async function runStream(
  sessionId: string,
  handle: ActiveStream,
  params: { command: string; history: StreamRequest['history']; effort: string; thinking: boolean; model?: string },
): Promise<void> {
  const { controller } = handle;
  const storage = defaultSessionStorage();

  const finish = (message: ChatMessage, snapshotStatus: StreamSnapshotStatus, error: string | null) => {
    try {
      patchAssistantMessage(storage, sessionId, handle.messageIndex, {
        content: message.content,
        thoughts: message.thoughts ? [...message.thoughts] : [],
        tools: message.tools ? [...message.tools] : [],
        metrics: message.metrics,
        status: message.status,
      });
    } catch {
      // Final persistence is best-effort; still notify local listeners.
    }
    handle.snapshot = {
      status: snapshotStatus,
      content: message.content,
      thoughts: message.thoughts ? [...message.thoughts] : [],
      tools: message.tools ? [...message.tools] : [],
      error,
    };
    notify(handle);
    activeStreams.delete(sessionId);
    handle.resolveSettled();
  };

  const createReply = (content: string, status: ChatMessage['status']): ChatMessage => {
    const completedAt = Date.now();
    const thoughts = handle.accumulatedThoughts.length > 0 ? [...handle.accumulatedThoughts] : undefined;
    const tools = handle.collectedTools.filter((tool) => tool.status === 'done');
    return {
      role: 'assistant',
      content,
      createdAt: completedAt,
      metrics: buildAssistantMessageMetrics({
        content,
        startedAt: handle.startedAt,
        firstTokenAt: handle.firstTokenAt,
        completedAt,
        toolCount: tools.length,
      }),
      thoughts,
      tools,
      status,
    };
  };

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message: params.command,
        history: params.history.map(({ role, content }) => ({ role, content })),
        effort: params.effort,
        thinking: params.thinking,
        model: params.model || undefined,
      }),
    });

    if (!res.ok) {
      let payload: unknown;
      try { payload = await res.json(); } catch { /* fall through to status-only failure */ }
      throw Object.assign(new Error('Chat stream failed'), streamFailureFromPayload(payload, res.status));
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No readable stream');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (controller.signal.aborted) {
        try { await reader.cancel(); } catch { /* reader already closed */ }
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
            handle.firstTokenAt ??= Date.now();
            let token: unknown = dataStr;
            try { token = JSON.parse(dataStr); } catch { /* raw string token */ }

            if (typeof token === 'string') {
              handle.snapshot.content += token.replace(/\\n/g, '\n');
            } else if (token && typeof token === 'object' && 'message' in token &&
              typeof (token as { message: unknown }).message === 'string') {
              handle.snapshot.content += (token as { message: string }).message;
            } else {
              handle.snapshot.content += String(token);
            }
            notify(handle);
            persistProgress(sessionId, handle, false);
          } else if (currentEvent === 'tool_start') {
            try {
              const data = JSON.parse(dataStr);
              handle.collectedTools.push({ tool: data.tool, status: 'running', args: data.args });
              handle.snapshot.tools = [...handle.collectedTools];
              handle.accumulatedThoughts.push(toolStartThought(data.tool, data.args));
              handle.snapshot.thoughts = [...handle.accumulatedThoughts];
              notify(handle);
              persistProgress(sessionId, handle, true);
            } catch { /* malformed tool event is non-fatal */ }
          } else if (currentEvent === 'tool_result') {
            try {
              const data = JSON.parse(dataStr);
              const idx = handle.collectedTools.findIndex((t) =>
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
                args: data.args ?? (idx !== -1 ? handle.collectedTools[idx].args : undefined),
              };
              if (idx !== -1) handle.collectedTools[idx] = next;
              else handle.collectedTools.push(next);
              handle.snapshot.tools = [...handle.collectedTools];
              handle.accumulatedThoughts.splice(
                0,
                handle.accumulatedThoughts.length,
                ...updateToolResultThought(handle.accumulatedThoughts, {
                  tool: data.tool,
                  args: next.args,
                  fact: data.fact,
                }),
              );
              handle.snapshot.thoughts = [...handle.accumulatedThoughts];
              notify(handle);
              persistProgress(sessionId, handle, true);
            } catch { /* malformed tool event is non-fatal */ }
          } else if (currentEvent === 'thought_new') {
            try {
              let data = JSON.parse(dataStr);
              if (typeof data !== 'string') {
                data = typeof data === 'object' && data !== null && 'text' in data
                  ? String((data as { text: unknown }).text)
                  : JSON.stringify(data);
              }
              handle.accumulatedThoughts.push(data);
            } catch {
              handle.accumulatedThoughts.push(dataStr);
            }
            handle.snapshot.thoughts = [...handle.accumulatedThoughts];
            notify(handle);
            persistProgress(sessionId, handle, true);
          } else if (currentEvent === 'thought') {
            let dataText = dataStr;
            try {
              let parsed: unknown = JSON.parse(dataStr);
              if (typeof parsed !== 'string') {
                parsed = typeof parsed === 'object' && parsed !== null && 'text' in parsed
                  ? String((parsed as { text: unknown }).text)
                  : JSON.stringify(parsed);
              }
              dataText = parsed as string;
            } catch { /* raw string thought */ }

            const lastIdx = handle.accumulatedThoughts.length - 1;
            const lastItem = lastIdx >= 0 ? handle.accumulatedThoughts[lastIdx] : null;
            const isLastItemToolOrHeader = lastItem && (
              lastItem.startsWith('tool used: ') ||
              lastItem.startsWith('• tool_call: ') ||
              lastItem.startsWith('Searched: ') ||
              lastItem.startsWith('Branching off:') ||
              lastItem.startsWith('Branches are in') ||
              lastItem.startsWith('Before answering')
            );

            if (handle.accumulatedThoughts.length === 0 || isLastItemToolOrHeader) {
              handle.accumulatedThoughts.push(dataText);
            } else {
              handle.accumulatedThoughts[lastIdx] += dataText;
            }
            handle.snapshot.thoughts = [...handle.accumulatedThoughts];
            notify(handle);
            persistProgress(sessionId, handle, true);
          } else if (currentEvent === 'error') {
            let payload: unknown;
            try { payload = JSON.parse(dataStr); } catch { payload = { message: dataStr }; }
            throw Object.assign(new Error('Chat stream failed'), streamFailureFromPayload(payload));
          }
        }
      }
    }

    if (controller.signal.aborted) {
      finish(
        createReply(handle.snapshot.content || '[Generation stopped]', 'cancelled'),
        'cancelled',
        null,
      );
      return;
    }
    if (!handle.snapshot.content) {
      const failure: ChatStreamFailure = { message: 'The stream ended before the model sent a final response' };
      finish(
        createReply(
          buildPausedChatResponse({
            completedResearch: handle.accumulatedThoughts.length > 0 ||
              handle.collectedTools.some((tool) => tool.status === 'done'),
            failure,
          }),
          'error',
        ),
        'error',
        describeChatStreamFailure(failure),
      );
      return;
    }
    finish(createReply(handle.snapshot.content, 'done'), 'done', null);
  } catch (err: unknown) {
    if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      finish(
        createReply(handle.snapshot.content || '[Generation stopped]', 'cancelled'),
        'cancelled',
        null,
      );
      return;
    }
    const failure = streamFailureFromError(err);
    finish(
      createReply(
        buildPausedChatResponse({
          partialContent: handle.snapshot.content,
          completedResearch: handle.accumulatedThoughts.length > 0 ||
            handle.collectedTools.some((tool) => tool.status === 'done'),
          failure,
        }),
        'error',
      ),
      'error',
      describeChatStreamFailure(failure),
    );
  }
}
