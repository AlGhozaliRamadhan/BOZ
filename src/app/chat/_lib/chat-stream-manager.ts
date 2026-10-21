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
  removeAssistantMessage,
} from './chat-sessions';
import type { ChatMessage } from './chat-types';

import {
  buildPausedChatResponse,
  describeChatStreamFailure,
  type ChatStreamFailure,
} from '@/shared/chat-stream-failure';
import type { ToolResult } from '@/shared/chat-tool-results';
import type { InterruptedRun } from '@/shared/chat-interrupted';

export type StreamSnapshotStatus = 'streaming' | 'done' | 'error' | 'cancelled';

/**
 * One entry in the thinking stream, in the order it actually happened.
 *
 * The whole point of this array is that it is NOT two lists. Reasoning and tool
 * activity interleave exactly as they occurred — thought, tool, what came back,
 * thought about that — because two separate lists lose the causal order, which
 * is the only reason to show a timeline at all.
 */
export type ThoughtStep =
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      tool: string;
      args?: Record<string, unknown>;
      status: 'running' | 'done';
      fact?: string;
      quality?: string;
      success?: boolean;
      preview?: string;
      detail?: string;
    };

/**
 * A provider request that failed transiently and is being retried.
 *
 * Carries only the failure's CODE, never the provider's message: this crosses
 * the same trust boundary as assistant text, and a raw error can hold an API
 * key or an internal URL.
 */
export interface StreamRetryState {
  attempt: number;
  allowance: number;
  delayMs: number;
  code: string;
  honoredRetryAfter: boolean;
  clamped: boolean;
  budgetRemaining: number;
  /** Epoch ms when the wait ends. Drives the countdown, not the retry. */
  until: number;
}

export interface StreamSnapshot {
  status: StreamSnapshotStatus;
  content: string;
  /**
   * The thinking stream, in chronological order.
   *
   * Reasoning and tool activity share this one list. Keeping them separate
   * destroyed the only thing worth showing — the order, and therefore the
   * causality — and made the panel read as two unrelated widgets.
   */
  steps: ThoughtStep[];
  /** Tool results in arrival order, for badge/copy affordances. */
  tools: ToolResult[];
  error: string | null;
  /** Present only while a scheduled backoff is in flight. */
  retry: StreamRetryState | null;
  /**
   * True once the model has begun producing thinking, even if no text has
   * landed yet. Lets the idle bubble say "Thinking…" for something specific
   * instead of a generic spinner.
   */
  reasoningActive: boolean;
}

/**
 * Resume point for a Continue: the index of the truncated assistant message
 * being healed, plus the exact text the model had already produced.
 */
export interface StreamContinuation {
  index: number;
  content: string;
}

export interface StreamRequest {
  sessionId: string;
  command: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  effort: string;
  thinking: boolean;
  model?: string;
  startedAt: number;
  continueFrom?: StreamContinuation;
  /** Work a cut-off generation left behind, so the model continues it. */
  interrupted?: InterruptedRun;
}

type SnapshotListener = (snapshot: StreamSnapshot) => void;

interface ActiveStream {
  sessionId: string;
  controller: AbortController;
  settled: Promise<void>;
  resolveSettled: () => void;
  snapshot: StreamSnapshot;
  messageIndex: number;
  startedAt: number;
  firstTokenAt?: number;
  /** The thinking stream, mutated in place and copied on publish. */
  steps: ThoughtStep[];
  /** Stable ids so a tool result can find its own `tool_start` entry. */
  nextStepId: number;
  collectedTools: ToolResult[];
  lastPersistedAt: number;
  /** Fallback that force-settles a stream whose abort never settled on its own. */
  stopFallbackTimer: ReturnType<typeof setTimeout> | null;
  forceCancel: (() => void) | null;
}

const activeStreams = new Map<string, ActiveStream>();

/**
 * Listeners are keyed by SESSION, not by stream object. A view subscribes once
 * when its route resolves, but generations start and end many times afterwards
 * (every follow-up message, every retry). Holding listeners on the stream
 * object meant each new stream started with an empty listener set, so a view
 * that subscribed earlier never saw the retry at all and kept rendering the
 * previous attempt's content.
 */
const streamListeners = new Map<string, Set<SnapshotListener>>();

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
 * Attaches a listener to the current generation of `sessionId`, for as long as
 * that session exists — not just for the stream running right now. The listener
 * fires immediately with the current snapshot so a remounted component renders
 * accumulated progress at once. Unmounting must only unsubscribe — never abort.
 */
export function subscribeToStream(sessionId: string, listener: SnapshotListener): () => void {
  let listeners = streamListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    streamListeners.set(sessionId, listeners);
  }
  listeners.add(listener);

  const handle = activeStreams.get(sessionId);
  if (handle) listener({ ...handle.snapshot, steps: handle.steps.map((s) => ({ ...s })), tools: [...handle.snapshot.tools] });

  return () => {
    const current = streamListeners.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) streamListeners.delete(sessionId);
  };
}

/**
 * User-initiated cancel. Returns false when nothing was running.
 * Aborting normally settles the reader loop as `cancelled` at once; the
 * fallback below guarantees it: if the abort hasn't settled the stream
 * within a few seconds (hung reader/fetch), the stream is force-finished
 * as `cancelled` so the Stop button always responds.
 */
export function stopStream(sessionId: string): boolean {
  const handle = activeStreams.get(sessionId);
  if (!handle) return false;
  handle.controller.abort();
  // A cancel must read as cancelled the moment it is pressed. The reader loop
  // settles the same way — usually at once — but a hung read delays that until
  // the force-cancel below, and meanwhile a reasoning flag or a retry
  // countdown would keep this session's "Thinking…" bubble implying the model
  // is still producing an answer it has already stopped producing.
  handle.snapshot.retry = null;
  handle.snapshot.reasoningActive = false;
  notify(handle);
  if (!handle.stopFallbackTimer) {
    handle.stopFallbackTimer = setTimeout(() => {
      handle.stopFallbackTimer = null;
      handle.forceCancel?.();
    }, 4000);
  }
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

/**
 * Locate the still-running tool entry a `tool_result` belongs to.
 *
 * Matching on tool name AND args, scanning newest first: two calls to the same
 * tool with the same arguments are legal, and settling the wrong one would show
 * the result attached to the wrong call.
 */
function findToolStepIndex(steps: ThoughtStep[], tool: string, args: unknown): number {
  const wanted = JSON.stringify(args ?? {});
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.kind !== 'tool' || step.tool !== tool) continue;
    if (step.status !== 'running') continue;
    if (JSON.stringify(step.args ?? {}) === wanted) return i;
  }
  return -1;
}

/**
 * Turn a two-character `\n` the model typed into a real line break.
 *
 * Providers that inline their working (no native reasoning channel) hand back
 * the block the model literally wrote, and models write `\n` as two characters.
 * JSON decoding leaves those intact, so the panel used to render "missing data
 * as missing.\n\n" with the escape on screen. The token path already did this;
 * reasoning is the same text arriving by another route.
 */
function unescapeLiteralNewlines(text: string): string {
  return text.replace(/\\n/g, '\n');
}

/**
 * Read one reasoning delta from its SSE payload.
 *
 * Validated rather than cast: the payload crosses the network, and a malformed
 * one must not inject `undefined` into the accumulated transcript.
 */
function reasoningTextFromPayload(dataStr: string): string {
  let payload: unknown;
  try { payload = JSON.parse(dataStr); } catch { return ''; }
  if (typeof payload === 'string') return unescapeLiteralNewlines(payload);
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text: unknown }).text;
    return typeof text === 'string' ? unescapeLiteralNewlines(text) : '';
  }
  return '';
}

/**
 * Parse a `retry` event into the countdown state.
 *
 * Validates every field rather than casting: the payload crosses the network
 * and a malformed one must never put NaN into a countdown or crash the reader.
 */
function retryStateFromPayload(dataStr: string): StreamRetryState | null {
  let payload: unknown;
  try { payload = JSON.parse(dataStr); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Record<string, unknown>;
  const attempt = Number(candidate.attempt);
  const allowance = Number(candidate.allowance);
  const delayMs = Number(candidate.delayMs);
  const budgetRemaining = Number(candidate.budgetRemaining);
  if (!Number.isFinite(attempt) || !Number.isFinite(allowance) || !Number.isFinite(delayMs)) return null;
  if (typeof candidate.code !== 'string' || candidate.code.length === 0) return null;

  const now = Date.now();
  return {
    attempt,
    allowance,
    delayMs,
    code: candidate.code,
    honoredRetryAfter: candidate.honoredRetryAfter === true,
    clamped: candidate.clamped === true,
    budgetRemaining: Number.isFinite(budgetRemaining) ? budgetRemaining : 0,
    // Derived from the remaining wait rather than trusted from the wire, so a
    // client clock skewed from the server cannot pin the countdown to zero.
    until: now + Math.max(0, delayMs),
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
  // A superseded handle (its stream already replaced by a newer generation)
  // must never paint over the live one.
  if (activeStreams.get(handle.sessionId) !== handle) return;
  const listeners = streamListeners.get(handle.sessionId);
  if (!listeners || listeners.size === 0) return;
  const snapshot: StreamSnapshot = {
    ...handle.snapshot,
    steps: handle.steps.map((step) => ({ ...step })),
    tools: [...handle.snapshot.tools],
  };
  for (const listener of listeners) {
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
      steps: handle.steps.map((step) => ({ ...step })),
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
 *
 * With `continueFrom`, the placeholder is seeded with the partial text so the
 * bubble visibly continues mid-sentence, and the truncated message it resumes
 * from is dropped first — the new message supersedes it, so the thread is left
 * with one healed answer instead of two copies of the same text. The drop
 * happens before the append so `messageIndex` stays valid.
 */
export function startStream(request: StreamRequest): boolean {
  const { sessionId, command, history, effort, thinking, model, startedAt, continueFrom, interrupted } = request;
  if (activeStreams.has(sessionId)) return false;

  const seededContent = continueFrom?.content ?? '';
  let messageIndex: number;
  try {
    const storage = defaultSessionStorage();
    if (continueFrom) removeAssistantMessage(storage, sessionId, continueFrom.index);
    messageIndex = appendAssistantMessage(
      storage,
      sessionId,
      { role: 'assistant', content: seededContent, createdAt: startedAt, status: 'streaming' },
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
    sessionId,
    controller,
    settled,
    resolveSettled,
    snapshot: { status: 'streaming', content: seededContent, steps: [], tools: [], error: null, retry: null, reasoningActive: false },
    messageIndex,
    startedAt,
    firstTokenAt: seededContent ? startedAt : undefined,
    steps: [],
    nextStepId: 0,
    collectedTools: [],
    lastPersistedAt: Date.now(),
    stopFallbackTimer: null,
    forceCancel: null,
  };
  activeStreams.set(sessionId, handle);
  // Publish the generation immediately. An attached view is about to render
  // this bubble at the bottom of the thread; without this it would keep
  // showing the previous attempt's content and thoughts until the first token
  // arrived, which reads as "the retry resumed where it left off".
  notify(handle);

  void runStream(sessionId, handle, {
    command,
    history,
    effort,
    thinking,
    model,
    continueFrom: seededContent || undefined,
    interrupted,
  });
  return true;
}

async function runStream(
  sessionId: string,
  handle: ActiveStream,
  params: {
    command: string;
    history: StreamRequest['history'];
    effort: string;
    thinking: boolean;
    model?: string;
    continueFrom?: string;
    interrupted?: InterruptedRun;
  },
): Promise<void> {
  const { controller } = handle;
  const storage = defaultSessionStorage();

  const finish = (message: ChatMessage, snapshotStatus: StreamSnapshotStatus, error: string | null) => {
    // Guard against double-settle (natural finish racing the stop fallback).
    if (activeStreams.get(sessionId) !== handle) return;
    if (handle.stopFallbackTimer) {
      clearTimeout(handle.stopFallbackTimer);
      handle.stopFallbackTimer = null;
    }
    try {
      patchAssistantMessage(storage, sessionId, handle.messageIndex, {
        content: message.content,
        steps: handle.steps.map((step) => ({ ...step })),
        tools: message.tools ? [...message.tools] : [],
        metrics: message.metrics,
        status: message.status,
        // Every terminal state that stops short of a complete answer keeps its
        // exact text as the resume point for Continue. `done` clears it — the
        // answer is whole, there is nothing left to resume.
        partial: message.status === 'done' ? '' : (message.partial ?? handle.snapshot.content),
      });
    } catch {
      // Final persistence is best-effort; still notify local listeners.
    }
    handle.snapshot = {
      status: snapshotStatus,
      content: message.content,
      // The stream survives settlement: it is the record of what the model did,
      // and it is already excluded from `content`, `partial`, and history.
      steps: handle.steps.map((step) => ({ ...step })),
      tools: message.tools ? [...message.tools] : [],
      error,
      // A terminal state never keeps a retry countdown: the backoff either
      // ran out and produced this outcome, or the user stopped it.
      retry: null,
      reasoningActive: false,
    };
    notify(handle);
    activeStreams.delete(sessionId);
    handle.resolveSettled();
    try {
      const completedAt = Date.now();
      console.info('[chat-stream] finished', {
        sessionId,
        reason: snapshotStatus,
        durationMs: completedAt - handle.startedAt,
        ttftMs: handle.firstTokenAt != null ? handle.firstTokenAt - handle.startedAt : null,
        contentChars: message.content.length,
      });
    } catch {
      // Logging must never break the stream.
    }
  };

  // Force-settles as user-cancelled when an abort never settled the stream
  // on its own. Always `cancelled`, never an error: stopping is not failing.
  handle.forceCancel = () => {
    if (activeStreams.get(sessionId) !== handle) return;
    finish(
      createReply(handle.snapshot.content || '[Generation stopped]', 'cancelled'),
      'cancelled',
      null,
    );
  };

  const createReply = (content: string, status: ChatMessage['status']): ChatMessage => {
    const completedAt = Date.now();
    const steps = handle.steps.length > 0 ? handle.steps.map((step) => ({ ...step })) : undefined;
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
      steps,
      tools,
      status,
    };
  };

  // Cancelling the reader unblocks a `reader.read()` stuck awaiting bytes,
  // so an abort settles the loop at once instead of hanging on the network.
  let readerRef: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const onAbortCancelReader = () => {
    try {
      void readerRef?.cancel();
    } catch {
      // Reader already closed.
    }
  };
  controller.signal.addEventListener('abort', onAbortCancelReader, { once: true });

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
        continueFrom: params.continueFrom,
        interrupted: params.interrupted,
      }),
    });

    if (!res.ok) {
      let payload: unknown;
      try { payload = await res.json(); } catch { /* fall through to status-only failure */ }
      throw Object.assign(new Error('Chat stream failed'), streamFailureFromPayload(payload, res.status));
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No readable stream');
    readerRef = reader as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const decoder = new TextDecoder();
    let buffer = '';
    let sawDone = false;

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
              handle.snapshot.content += unescapeLiteralNewlines(token);
            } else if (token && typeof token === 'object' && 'message' in token &&
              typeof (token as { message: unknown }).message === 'string') {
              handle.snapshot.content += (token as { message: string }).message;
            } else {
              handle.snapshot.content += String(token);
            }
            // Output resumed, so the backoff that preceded it is over.
            handle.snapshot.retry = null;
            notify(handle);
            persistProgress(sessionId, handle, false);
          } else if (currentEvent === 'done') {
            sawDone = true;
          } else if (currentEvent === 'tool_start') {
            try {
              const data = JSON.parse(dataStr);
              handle.collectedTools.push({ tool: data.tool, status: 'running', args: data.args });
              handle.snapshot.tools = [...handle.collectedTools];
              // Appended to the SAME stream the model's thinking goes into, at
              // the moment it happened — not into a separate list rendered
              // elsewhere, which is what destroyed the causal order.
              handle.steps.push({
                kind: 'tool',
                id: `tool-${handle.nextStepId++}`,
                tool: data.tool,
                args: data.args,
                status: 'running',
              });
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

              // Settle the `tool_start` entry IN PLACE so the stream keeps the
              // order it happened in; appending a second entry would show the
              // same call twice.
              const stepIdx = findToolStepIndex(handle.steps, data.tool, data.args);
              const settled: Extract<ThoughtStep, { kind: 'tool' }> = {
                kind: 'tool',
                id: stepIdx >= 0 ? handle.steps[stepIdx].id : `tool-${handle.nextStepId++}`,
                tool: data.tool,
                args: next.args,
                status: 'done',
                fact: next.fact,
                quality: next.quality,
                success: next.success,
                preview: next.preview,
                detail: next.detail,
              };
              if (stepIdx >= 0) handle.steps[stepIdx] = settled;
              else handle.steps.push(settled);

              notify(handle);
              persistProgress(sessionId, handle, true);
            } catch { /* malformed tool event is non-fatal */ }
          } else if (currentEvent === 'reasoning') {
            // Real thinking. Appended to the stream at its arrival point, and
            // extended in place while a block is still open — one pass is one
            // entry, not one entry per token.
            const text = reasoningTextFromPayload(dataStr);
            if (text) {
              const last = handle.steps[handle.steps.length - 1];
              if (last && last.kind === 'reasoning') {
                // Still inside the same block: one pass is one entry, not one
                // entry per token. A tool call in between breaks contiguity and
                // starts a new block, which is exactly the boundary we want.
                last.text += text;
              } else {
                handle.steps.push({ kind: 'reasoning', id: `think-${handle.nextStepId++}`, text });
              }
              handle.snapshot.reasoningActive = true;
              notify(handle);
              persistProgress(sessionId, handle, false);
            }
          } else if (currentEvent === 'reasoning_start') {
            // The provider opened its reasoning channel. Flipped before the
            // first delta so a long silent pass reads as "Reasoning..." rather
            // than as a stalled request.
            if (!handle.snapshot.reasoningActive) {
              handle.snapshot.reasoningActive = true;
              notify(handle);
            }
          } else if (currentEvent === 'retry') {
            // A scheduled backoff. Shown, not persisted: it describes a wait
            // that is still running, and the next event (a token, another
            // retry, or a terminal event) supersedes it.
            const parsed = retryStateFromPayload(dataStr);
            if (parsed) {
              handle.snapshot.retry = parsed;
              notify(handle);
            }
          } else if (currentEvent === 'error') {
            let payload: unknown;
            try { payload = JSON.parse(dataStr); } catch { payload = { message: dataStr }; }
            throw Object.assign(new Error('Chat stream failed'), streamFailureFromPayload(payload));
          }
        }
      }
    }

    controller.signal.removeEventListener('abort', onAbortCancelReader);

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
            completedResearch: handle.steps.length > 0 ||
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
    if (!sawDone) {
      // Connection closed after partial tokens without a terminal `done`
      // event — treat as interrupted, not success, so retry shows.
      const failure: ChatStreamFailure = {
        code: 'connection_interrupted',
        message: 'Connection closed before the final response completed',
      };
      finish(
        createReply(
          buildPausedChatResponse({
            partialContent: handle.snapshot.content,
            completedResearch: handle.steps.length > 0 ||
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
    controller.signal.removeEventListener('abort', onAbortCancelReader);
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
          completedResearch: handle.steps.length > 0 ||
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
