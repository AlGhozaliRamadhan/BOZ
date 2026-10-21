import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStreamSnapshot,
  isStreamActive,
  startStream,
  stopStream,
  subscribeToStream,
  waitForStream,
  type StreamSnapshot,
} from '../src/app/chat/_lib/chat-stream-manager';
import {
  defaultSessionStorage,
  readSessions,
  upsertSession,
} from '../src/app/chat/_lib/chat-sessions';

// ─── chat-stream-manager isolation ──────────────────────────────────────────
// Each chat is its own generation: the manager is keyed per session, and a
// cancelled or background run in one session must never stream into another.
// These tests drive the real runner with a stubbed fetch + SSE reader and
// lock in the cancel contract (Stop always settles `cancelled`, demotes the
// reasoning/retry flags, persists the status) and the cross-session wall
// (session B's listener never sees session A's frames; a later session
// starts with an empty stream).

/** Text into bytes: matches how the manager feeds TextDecoder. */
function encode(chunk: string): Uint8Array {
  return new TextEncoder().encode(chunk);
}

// The module under test reads/writes through its own `defaultSessionStorage()`
// (module-level memory fallback outside a browser), so the tests seed and
// assert against that same instance — never a private stand-in store.

interface ReaderControl {
  /** Locks out further reads, as a browser reader cancel does. */
  setCancelled(): void;
}

/**
 * A fetch stub that streams `script` SSE chunks in order. When the script is
 * exhausted the read parks unresolved — a live-but-quiet connection waiting
 * for the next event — until `cancel()` unblocks it with a final `done`,
 * mirroring how a real reader cancel resolves a pending `read()`.
 */
function stubSequentialFetch(script: string[]): ReaderControl {
  let index = 0;
  let cancelled = false;
  let parkedResolve: ((value: { done: boolean; value: Uint8Array | undefined }) => void) | null = null;
  const reader = {
    read: () => {
      if (cancelled) {
        return Promise.resolve({ done: true, value: undefined });
      }
      if (index < script.length) {
        const chunk = script[index++];
        return Promise.resolve({ done: false, value: encode(chunk) });
      }
      return new Promise((resolve) => {
        parkedResolve = resolve;
      });
    },
    cancel: () => {
      cancelled = true;
      parkedResolve?.({ done: true, value: undefined });
      parkedResolve = null;
      return Promise.resolve();
    },
  };
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, body: { getReader: () => reader } }),
  ));
  return { setCancelled: () => { cancelled = true; } };
}

/**
 * A fetch stub whose reader hangs forever and ignores cancel — the hung
 * request the manager's force-cancel fallback exists for. Never settles a
 * read; Stop must still settle the stream through the module timer.
 */
function stubHangingFetch(): void {
  const reader = {
    read: () => new Promise<{ done: false }>(() => {}),
    cancel: () => Promise.resolve(),
  };
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, body: { getReader: () => reader } }),
  ));
}

const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function seedUserTurn(id: string): Promise<void> {
  upsertSession(defaultSessionStorage(), {
    id,
    title: id,
    messages: [{ role: 'user', content: 'question', createdAt: 1 }],
    updatedAt: 1,
  });
}

function storedSession(id: string) {
  return readSessions(defaultSessionStorage()).find((s) => s.id === id) ?? null;
}

describe('chat stream manager: per-session isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('settles a cancelled run as cancelled and persists the status, without ever notifying another session', async () => {
    const idA = 'session-a';
    await seedUserTurn(idA);

    stubSequentialFetch([
      sse('reasoning', { text: 'weighing the setup' }),
      sse('token', 'Part of the answer'),
      sse('retry', {
        attempt: 1,
        allowance: 3,
        delayMs: 900,
        code: 'RATE_LIMIT',
        honoredRetryAfter: false,
        clamped: true,
        budgetRemaining: 1000,
      }),
      // No `done`: the user stops during a provider retry backoff.
    ]);

    const framesA: StreamSnapshot[] = [];
    const framesB: StreamSnapshot[] = [];
    subscribeToStream(idA, (next) => framesA.push(next));
    // A different chat subscribes to its own session before A even runs.
    subscribeToStream('session-b-unsent', (next) => framesB.push(next));

    expect(startStream({
      sessionId: idA,
      command: 'question',
      history: [{ role: 'user', content: 'question' }],
      effort: 'Low',
      thinking: true,
      startedAt: Date.now(),
    })).toBe(true);
    expect(isStreamActive(idA)).toBe(true);

    // Let the reader process every scripted frame; the last read parks
    // (connection quiet) exactly as a real stream would before a terminal
    // event, so the run is still live when the test presses Stop.
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Notify frames are the runtime views (the raw snapshot only redraws its
    // `steps` on publish/finish), so assert the stream through them.
    const latestFrame = framesA[framesA.length - 1];
    const observed = getStreamSnapshot(idA);
    expect(observed?.content).toContain('Part of the answer');
    expect(latestFrame.steps.map((step) => step.kind)).toEqual(['reasoning']);
    expect(observed?.retry?.code).toBe('RATE_LIMIT');

    // Another session's listener must have seen nothing all along.
    expect(framesB).toEqual([]);
    // The same session's listeners kept receiving frames.
    expect(framesA.length).toBeGreaterThan(0);

    expect(stopStream(idA)).toBe(true);
    // The stop press itself demotes the retry countdown right away.
    expect(getStreamSnapshot(idA)?.retry).toBeNull();

    await waitForStream(idA).then(() => expect(isStreamActive(idA)).toBe(false));

    const terminal = framesA[framesA.length - 1];
    expect(terminal.status).toBe('cancelled');
    expect(terminal.retry).toBeNull();
    expect(terminal.reasoningActive).toBe(false);

    // No sprinkles into the other session, ever.
    expect(framesB).toEqual([]);
    expect(getStreamSnapshot('session-b-unsent')).toBeNull();

    // The session store healed: the assistant row is no longer `streaming`.
    const session = storedSession(idA);
    const last = session?.messages[session.messages.length - 1];
    expect(last?.role).toBe('assistant');
    expect(last?.status).toBe('cancelled');
  });

  it('starts a later session clean: no steps, tools, or text carry over from the cancelled chat', async () => {
    const idA = 'cancelled-one';
    await seedUserTurn(idA);
    stubSequentialFetch([sse('token', 'aborted answer')]);
    expect(startStream({
      sessionId: idA,
      command: 'question',
      history: [],
      effort: 'Low',
      thinking: true,
      startedAt: Date.now(),
    })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopStream(idA);
    await waitForStream(idA);

    await seedUserTurn('fresh-two');
    const freshFrames: StreamSnapshot[] = [];
    subscribeToStream('fresh-two', (next) => freshFrames.push(next));
    stubSequentialFetch([sse('reasoning', { text: 'brand new thought' })]);
    expect(startStream({
      sessionId: 'fresh-two',
      command: 'second question',
      history: [{ role: 'user', content: 'second question' }],
      effort: 'Low',
      thinking: true,
      startedAt: Date.now(),
    })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const fresh = freshFrames[freshFrames.length - 1];
    expect(fresh.steps.map((step) => step.kind === 'reasoning' ? step.text : step.tool)).toEqual(['brand new thought']);
    expect(fresh.content).toBe('');
    expect(isStreamActive(idA)).toBe(false);
    // The cancelled session's record is untouched by the new run.
    expect(storedSession(idA)?.messages.some((m) => m.role === 'assistant' && m.content === 'aborted answer' && m.status === 'cancelled')).toBe(true);
    stopStream('fresh-two');
    await waitForStream('fresh-two');
  });

  it('force-settles a hung reader as cancelled, and the hang never touches another session', async () => {
    vi.useFakeTimers();
    const idA = 'hung-one';
    await seedUserTurn(idA);
    stubHangingFetch();
    expect(startStream({
      sessionId: idA,
      command: 'question',
      history: [],
      effort: 'Low',
      thinking: true,
      startedAt: Date.now(),
    })).toBe(true);

    const framesOfHang: StreamSnapshot[] = [];
    subscribeToStream(idA, (next) => framesOfHang.push(next));

    const unnotified: StreamSnapshot[] = [];
    subscribeToStream('hung-other', (next) => unnotified.push(next));

    expect(stopStream(idA)).toBe(true);
    // The reader never settles on its own; the module fallback must.
    const settled = waitForStream(idA);
    await vi.advanceTimersByTimeAsync(4_100);
    await settled;
    expect(isStreamActive(idA)).toBe(false);
    expect(framesOfHang[framesOfHang.length - 1]?.status).toBe('cancelled');
    expect(unnotified).toEqual([]);
  });
});
