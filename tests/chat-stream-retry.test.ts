import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startStream,
  subscribeToStream,
  waitForStream,
  type StreamSnapshot,
} from '../src/app/chat/_lib/chat-stream-manager';
import {
  readSessions,
  upsertSession,
  type ChatSessionStorage,
} from '../src/app/chat/_lib/chat-sessions';
import type { ChatMessage } from '../src/app/chat/_lib/chat-types';

// Retry after a paused response used to leave the view rendering the PREVIOUS
// attempt: the chat view subscribes once when its route resolves, but the
// subscription was bound to whichever stream object existed at that moment.
// A retry starts a brand-new stream, so the view never saw it — the stale
// content and thought accordion kept rendering as if the run had continued,
// and the fresh generation never appeared at the bottom of the thread.

const CHAT_ID = 'chat-retry';

function useFakeStorage(): ChatSessionStorage {
  const store = new Map<string, string>();
  const storage: ChatSessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  vi.stubGlobal('window', { localStorage: storage, dispatchEvent: () => {} });
  return storage;
}

function seedPausedThread(storage: ChatSessionStorage): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'why is tesla down', createdAt: 1 },
    {
      role: 'assistant',
      content: '**Response paused.** BOZ did not finish a final answer.',
      createdAt: 2,
      steps: [{ kind: 'tool' as const, id: 't1', tool: 'fetch_price', status: 'done' as const, fact: 'quoted' }],
      status: 'error',
    },
  ];
  upsertSession(storage, { id: CHAT_ID, title: 'Tesla', messages, updatedAt: 0 });
  return messages;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, body } as unknown as Response;
}

function streamRequest(command = 'why is tesla down') {
  return {
    sessionId: CHAT_ID,
    command,
    history: [{ role: 'user' as const, content: command }],
    effort: 'Medium',
    thinking: true,
    startedAt: Date.now(),
  };
}

function sessionMessages(storage: ChatSessionStorage): ChatMessage[] {
  return readSessions(storage).find((s) => s.id === CHAT_ID)!.messages;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the unified thinking stream', () => {
  // The panel used to render two separate lists — canned "AI reads" and real
  // tool markers — which lost the order and read as two unrelated widgets. Now
  // one chronological list holds the model's own thinking and the tools it ran.
  it('interleaves thinking and tool calls in the order they happened', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      'event: reasoning\ndata: {"text":"They asked about NVDA, so I need price first."}\n\n',
      'event: tool_start\ndata: {"tool":"fetch_ticker_dashboard","args":{"symbol":"NVDA"}}\n\n',
      'event: tool_result\ndata: {"tool":"fetch_ticker_dashboard","args":{"symbol":"NVDA"},"fact":"Price 216.91"}\n\n',
      'event: reasoning\ndata: {"text":"Price is in hand; now the catalyst."}\n\n',
      'event: token\ndata: "Wait for the dip."\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    startStream(streamRequest());
    await waitForStream(CHAT_ID);
    unsubscribe();

    const steps = seen.at(-1)!.steps;
    expect(steps.map((s) => s.kind)).toEqual(['reasoning', 'tool', 'reasoning']);
    expect(steps[0]).toMatchObject({ kind: 'reasoning' });
    expect(steps[1]).toMatchObject({ kind: 'tool', tool: 'fetch_ticker_dashboard', status: 'done', fact: 'Price 216.91' });
  });

  it('settles a tool result into its own start entry, never a duplicate', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      'event: tool_start\ndata: {"tool":"risk_calc","args":{"side":"long"}}\n\n',
      'event: tool_result\ndata: {"tool":"risk_calc","args":{"side":"long"},"fact":"R:R 2.4"}\n\n',
      'event: token\ndata: "ok"\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    startStream(streamRequest());
    await waitForStream(CHAT_ID);
    unsubscribe();

    const tools = seen.at(-1)!.steps.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ status: 'done', fact: 'R:R 2.4' });
  });

  it('groups contiguous reasoning into one entry rather than one per delta', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      'event: reasoning\ndata: {"text":"First "}\n\n',
      'event: reasoning\ndata: {"text":"thought."}\n\n',
      'event: token\ndata: "answer"\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    startStream(streamRequest());
    await waitForStream(CHAT_ID);
    unsubscribe();

    const steps = seen.at(-1)!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'reasoning', text: 'First thought.' });
  });

  // A provider with no native reasoning channel inlines the block the model
  // literally wrote, and models write "\n" as two characters. JSON decoding
  // leaves those intact, so the panel rendered "missing data as missing.\n\n"
  // with the escape visible on screen.
  it('turns a typed \\n into a real line break instead of showing the escape', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      'event: reasoning\ndata: {"text":"No ticker, so no data.\\n\\nI will just answer."}\n\n',
      'event: token\ndata: "hi"\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    startStream(streamRequest('hi'));
    await waitForStream(CHAT_ID);
    unsubscribe();

    const reasoning = seen.at(-1)!.steps.find((s) => s.kind === 'reasoning');
    expect(reasoning).toMatchObject({ kind: 'reasoning' });
    expect((reasoning as { text: string }).text).toBe('No ticker, so no data.\n\nI will just answer.');
    expect((reasoning as { text: string }).text).not.toContain('\\n');
  });

  it('never puts reasoning into the answer', async () => {
    const storage = useFakeStorage();
    seedPausedThread(storage);
    vi.stubGlobal('fetch', async () => sseResponse([
      'event: reasoning\ndata: {"text":"private working"}\n\n',
      'event: token\ndata: "Wait for the dip."\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    startStream(streamRequest());
    await waitForStream(CHAT_ID);

    const messages = sessionMessages(storage);
    expect(messages.at(-1)!.content).toBe('Wait for the dip.');
    expect(messages.at(-1)!.content).not.toContain('private working');
    // Kept beside the answer, not inside it.
    expect(JSON.stringify(messages.at(-1)!.steps)).toContain('private working');
  });
});

/** One `retry` notice as the SSE route emits it. */
function retryEvent(overrides: Record<string, unknown> = {}): string {
  return `event: retry\ndata: ${JSON.stringify({
    attempt: 1,
    allowance: 2,
    delayMs: 4000,
    code: 'RATE_LIMIT',
    honoredRetryAfter: true,
    clamped: false,
    budgetRemaining: 4,
    ...overrides,
  })}\n\n`;
}

describe('in-flight provider retry notices', () => {
  it('publishes a scheduled retry on the snapshot', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      retryEvent(),
      'event: token\ndata: "recovered"\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    expect(startStream(streamRequest())).toBe(true);
    await waitForStream(CHAT_ID);
    unsubscribe();

    const withRetry = seen.filter((s) => s.retry !== null);
    expect(withRetry.length).toBeGreaterThan(0);
    expect(withRetry.at(-1)!.retry).toMatchObject({
      attempt: 1,
      allowance: 2,
      code: 'RATE_LIMIT',
      honoredRetryAfter: true,
      clamped: false,
      budgetRemaining: 4,
    });
    // The countdown is derived locally, never trusted from the wire.
    expect(withRetry.at(-1)!.retry!.until).toBeGreaterThan(Date.now());
  });

  it('clears the countdown once output resumes', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      retryEvent(),
      'event: token\ndata: "recovered"\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    startStream(streamRequest());
    await waitForStream(CHAT_ID);
    unsubscribe();

    // Otherwise the UI would keep showing "retrying in 4s" over live output.
    const afterTokens = seen.filter((s) => s.content === 'recovered');
    expect(afterTokens.every((s) => s.retry === null)).toBe(true);
    expect(seen.at(-1)!.retry).toBeNull();
  });

  it('drops the countdown on a terminal outcome', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      retryEvent(),
      'event: error\ndata: {"code":"provider_authentication","message":"check settings"}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    startStream(streamRequest());
    await waitForStream(CHAT_ID);
    unsubscribe();

    expect(seen.at(-1)!.status).toBe('error');
    expect(seen.at(-1)!.retry).toBeNull();
  });

  it('ignores a malformed notice instead of putting NaN on screen', async () => {
    seedPausedThread(useFakeStorage());
    vi.stubGlobal('fetch', async () => sseResponse([
      'event: retry\ndata: {"attempt":"soon","code":""}\n\n',
      'event: retry\ndata: not json\n\n',
      'event: token\ndata: "fine"\n\n',
      'event: done\ndata: {}\n\n',
    ]));

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (s) => seen.push(s));
    startStream(streamRequest());
    await waitForStream(CHAT_ID);
    unsubscribe();

    expect(seen.every((s) => s.retry === null)).toBe(true);
    expect(seen.at(-1)).toMatchObject({ status: 'done', content: 'fine' });
  });
});

describe('chat stream retry', () => {
  it('delivers a generation started after the view subscribed', async () => {
    const storage = useFakeStorage();
    seedPausedThread(storage);
    vi.stubGlobal('fetch', async () =>
      sseResponse([
        'event: thought_new\ndata: "re-planning"\n\n',
        'event: token\ndata: "fresh answer"\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    );

    const seen: StreamSnapshot[] = [];
    // The chat view subscribes when /chat/[id] resolves — before any stream runs.
    const unsubscribe = subscribeToStream(CHAT_ID, (snapshot) => seen.push(snapshot));

    expect(startStream(streamRequest())).toBe(true);
    await waitForStream(CHAT_ID);
    unsubscribe();

    // An empty bubble lands at the bottom before the first token, so the
    // previous attempt's content and thinking stream cannot bleed into the retry.
    expect(seen[0]).toMatchObject({ status: 'streaming', content: '', steps: [] });
    expect(seen.some((s) => s.content === 'fresh answer')).toBe(true);
    expect(seen.at(-1)).toMatchObject({ status: 'done', content: 'fresh answer' });
  });

  it('appends the retry as a new assistant message instead of reusing the paused one', async () => {
    const storage = useFakeStorage();
    seedPausedThread(storage);
    vi.stubGlobal('fetch', async () =>
      sseResponse(['event: token\ndata: "fresh answer"\n\n', 'event: done\ndata: {}\n\n']),
    );

    expect(startStream(streamRequest())).toBe(true);
    await waitForStream(CHAT_ID);

    const messages = sessionMessages(storage);
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toContain('Response paused');
    expect(messages[1].status).toBe('error');
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: 'fresh answer',
      status: 'done',
    });
  });

  it('restarts clean on every retry instead of resuming the last attempt', async () => {
    const storage = useFakeStorage();
    seedPausedThread(storage);

    const seen: StreamSnapshot[] = [];
    const unsubscribe = subscribeToStream(CHAT_ID, (snapshot) => seen.push(snapshot));

    for (const answer of ['first answer', 'second answer']) {
      vi.stubGlobal('fetch', async () =>
        sseResponse([`event: token\ndata: "${answer}"\n\n`, 'event: done\ndata: {}\n\n']),
      );
      expect(startStream(streamRequest())).toBe(true);
      await waitForStream(CHAT_ID);
    }
    unsubscribe();

    // Each retry opens with an empty bubble: the previous run's text and
    // thought accordion are never carried into the new generation.
    const starts = seen.filter((s) => s.status === 'streaming' && s.content === '');
    expect(starts).toHaveLength(2);

    const messages = sessionMessages(storage);
    expect(messages.map((m) => m.content)).toEqual([
      'why is tesla down',
      expect.stringContaining('Response paused'),
      'first answer',
      'second answer',
    ]);
  });
});