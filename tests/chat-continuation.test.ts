import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startStream,
  waitForStream,
  type StreamSnapshot,
} from '../src/app/chat/_lib/chat-stream-manager';
import {
  readSessions,
  upsertSession,
  type ChatSessionStorage,
} from '../src/app/chat/_lib/chat-sessions';
import type { ChatMessage } from '../src/app/chat/_lib/chat-types';
import { WebChatEngine } from '../src/app/api/chat/chat.engine';

// A dropped connection, a Stop, or an app reload can cut the final answer off
// mid-sentence. The text that made it is persisted (`partial`), and Continue
// hands it back to the model to finish instead of throwing the work away.

const CHAT_ID = 'chat-continue';
const PARTIAL = 'My take: I would wait for the pullback, then work the long toward the highs, I';

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

/** A session whose last reply was cut off, with its resume point stored. */
function seedTruncatedThread(storage: ChatSessionStorage): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'intraday nvx', createdAt: 1 },
    {
      role: 'assistant',
      content: `${PARTIAL}\n\n---\n\n**Response paused.** BOZ did not finish a final answer.`,
      partial: PARTIAL,
      createdAt: 2,
      status: 'error',
    },
  ];
  upsertSession(storage, { id: CHAT_ID, title: 'NVDA', messages, updatedAt: 0 });
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

function sessionMessages(storage: ChatSessionStorage): ChatMessage[] {
  return readSessions(storage).find((s) => s.id === CHAT_ID)!.messages;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('continue a truncated answer', () => {
  it('heals the truncated bubble instead of adding a second one', async () => {
    const storage = useFakeStorage();
    seedTruncatedThread(storage);
    vi.stubGlobal('fetch', async () =>
      sseResponse(['event: token\ndata: " would wait for confirmation."\n\n', 'event: done\ndata: {}\n\n']),
    );

    expect(
      startStream({
        sessionId: CHAT_ID,
        command: 'intraday nvx',
        history: [{ role: 'user', content: 'intraday nvx' }],
        effort: 'Medium',
        thinking: true,
        startedAt: Date.now(),
        continueFrom: { index: 1, content: PARTIAL },
      }),
    ).toBe(true);
    await waitForStream(CHAT_ID);

    const messages = sessionMessages(storage);
    // One bubble, not two: the truncated message is superseded by the healed one.
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: `${PARTIAL} would wait for confirmation.`,
      status: 'done',
    });
    // A complete answer has nothing left to resume, and no paused notice.
    expect(messages[1].partial).toBe('');
    expect(messages[1].content).not.toContain('Response paused');
  });

  it('seeds the live bubble with the partial so it visibly continues mid-sentence', async () => {
    const storage = useFakeStorage();
    seedTruncatedThread(storage);
    vi.stubGlobal('fetch', async () =>
      sseResponse(['event: token\ndata: " would wait."\n\n', 'event: done\ndata: {}\n\n']),
    );

    const seen: StreamSnapshot[] = [];
    const { subscribeToStream } = await import('../src/app/chat/_lib/chat-stream-manager');
    const unsubscribe = subscribeToStream(CHAT_ID, (snapshot) => seen.push(snapshot));

    startStream({
      sessionId: CHAT_ID,
      command: 'intraday nvx',
      history: [{ role: 'user', content: 'intraday nvx' }],
      effort: 'Medium',
      thinking: true,
      startedAt: Date.now(),
      continueFrom: { index: 1, content: PARTIAL },
    });
    await waitForStream(CHAT_ID);
    unsubscribe();

    // The first snapshot already carries the partial: the sentence is picked
    // up mid-word rather than restarting.
    expect(seen[0]).toMatchObject({ status: 'streaming', content: PARTIAL });
    expect(seen.at(-1)?.content).toBe(`${PARTIAL} would wait.`);
  });

  it('sends the partial text to the model instead of the paused bubble', async () => {
    const storage = useFakeStorage();
    seedTruncatedThread(storage);
    let body: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      body = JSON.parse(init?.body ?? '{}');
      return sseResponse(['event: token\ndata: " rest"\n\n', 'event: done\ndata: {}\n\n']);
    });

    startStream({
      sessionId: CHAT_ID,
      command: 'intraday nvx',
      history: [{ role: 'user', content: 'intraday nvx' }],
      effort: 'Medium',
      thinking: true,
      startedAt: Date.now(),
      continueFrom: { index: 1, content: PARTIAL },
    });
    await waitForStream(CHAT_ID);

    expect(body).toMatchObject({ continueFrom: PARTIAL });
    // The paused notice must never reach the model as context.
    expect(JSON.stringify(body)).not.toContain('Response paused');
  });

  it('records the partial text of a truncated run so Continue can be offered', async () => {
    const storage = useFakeStorage();
    upsertSession(storage, {
      id: CHAT_ID,
      title: 'NVDA',
      messages: [{ role: 'user', content: 'intraday nvx', createdAt: 1 }],
      updatedAt: 0,
    });
    // Tokens arrive, then the connection closes without a terminal `done`.
    vi.stubGlobal('fetch', async () =>
      sseResponse(['event: token\ndata: "First half of the ans"\n\n']),
    );

    startStream({
      sessionId: CHAT_ID,
      command: 'intraday nvx',
      history: [],
      effort: 'Medium',
      thinking: true,
      startedAt: Date.now(),
    });
    await waitForStream(CHAT_ID);

    const messages = sessionMessages(storage);
    const [, message] = messages;
    expect(message.status).toBe('error');
    // The reader-facing bubble keeps the notice; `partial` is the clean resume point.
    expect(message.content).toContain('First half of the ans');
    expect(message.content).toContain('Response paused');
    expect(message.partial).toBe('First half of the ans');
  });
});

describe('retry re-answers the same bubble', () => {
  // Retry used to APPEND: the paused notice stayed in the thread and a fresh
  // bubble opened under it, so a second failure left two "Response paused."
  // cards stacked. A retry re-answers the same turn, so it takes the same
  // bubble the failure left behind.
  it('replaces the failed bubble instead of stacking another one', async () => {
    const storage = useFakeStorage();
    seedTruncatedThread(storage);
    vi.stubGlobal('fetch', async () =>
      sseResponse(['event: token\ndata: "Fresh answer."\n\n', 'event: done\ndata: {}\n\n']),
    );

    // What the hook sends: the failed message's index with empty seed text,
    // because a retry starts over rather than resuming mid-sentence.
    startStream({
      sessionId: CHAT_ID,
      command: 'intraday nvx',
      history: [{ role: 'user', content: 'intraday nvx' }],
      effort: 'Medium',
      thinking: true,
      startedAt: Date.now(),
      continueFrom: { index: 1, content: '' },
    });
    await waitForStream(CHAT_ID);

    const messages = sessionMessages(storage);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Fresh answer.', status: 'done' });
    expect(messages[1].content).not.toContain('Response paused');
    // The superseded attempt carries nothing forward: no stale partial, so
    // Continue cannot later resume text the retry already replaced.
    expect(messages[1].partial).toBe('');
  });

  it('starts the live bubble empty, never prefilled with the failed text', async () => {
    const storage = useFakeStorage();
    seedTruncatedThread(storage);
    vi.stubGlobal('fetch', async () =>
      sseResponse(['event: token\ndata: "New take."\n\n', 'event: done\ndata: {}\n\n']),
    );

    const seen: StreamSnapshot[] = [];
    const { subscribeToStream } = await import('../src/app/chat/_lib/chat-stream-manager');
    const unsubscribe = subscribeToStream(CHAT_ID, (snapshot) => seen.push(snapshot));

    startStream({
      sessionId: CHAT_ID,
      command: 'intraday nvx',
      history: [{ role: 'user', content: 'intraday nvx' }],
      effort: 'Medium',
      thinking: true,
      startedAt: Date.now(),
      continueFrom: { index: 1, content: '' },
    });
    await waitForStream(CHAT_ID);
    unsubscribe();

    expect(seen[0]).toMatchObject({ status: 'streaming', content: '' });
  });

  it('survives a second failure landing on the same bubble', async () => {
    const storage = useFakeStorage();
    seedTruncatedThread(storage);
    // No `done`: the stream dies mid-answer again.
    vi.stubGlobal('fetch', async () => sseResponse(['event: token\ndata: "Half an ans"\n\n']));

    startStream({
      sessionId: CHAT_ID,
      command: 'intraday nvx',
      history: [{ role: 'user', content: 'intraday nvx' }],
      effort: 'Medium',
      thinking: true,
      startedAt: Date.now(),
      continueFrom: { index: 1, content: '' },
    });
    await waitForStream(CHAT_ID);

    const messages = sessionMessages(storage);
    expect(messages).toHaveLength(2);
    expect(messages[1].status).toBe('error');
    expect(messages[1].partial).toBe('Half an ans');
    // The first attempt's notice is gone, replaced by the retry's own.
    expect(messages.filter((m) => m.content.includes('Response paused'))).toHaveLength(1);
  });
});

describe('engine continuation', () => {
  function engineWithScriptedLlm(script: Array<{ text?: string; error?: unknown }>) {
    const engine = new WebChatEngine();
    let calls = 0;
    const prompts: Array<Array<{ role: string; content: string }>> = [];
    (engine as any).llm = {
      callTextStream: async function* (opts: { messages: Array<{ role: string; content: string }> }) {
        const step = script[Math.min(calls, script.length - 1)];
        calls++;
        prompts.push(opts.messages);
        if (step.text) yield step.text;
        if (step.error) throw step.error;
      },
    };
    return { engine, calls: () => calls, prompts };
  }

  it('prefills the unfinished answer and asks only for the rest', async () => {
    const { engine, prompts } = engineWithScriptedLlm([{ text: ' would wait for confirmation.' }]);

    const events = [];
    for await (const ev of (engine as any).streamContinuation({
      partial: PARTIAL,
      history: [{ role: 'user', content: 'intraday nvx' }],
    })) events.push(ev);

    expect(events).toEqual([{ type: 'token', data: ' would wait for confirmation.' }]);
    const messages = prompts[0];
    // The partial arrives as the model's own prior assistant turn, so it
    // resumes the sentence instead of answering the question again.
    expect(messages.find((m: { role: string }) => m.role === 'assistant')?.content).toBe(PARTIAL);
    expect(messages.at(-1)?.content).toContain('Continue the answer above');
  });

  it(
    're-prefills with what it already produced instead of restarting the sentence',
    { timeout: 20000 },
    async () => {
      const { engine, prompts } = engineWithScriptedLlm([
        { text: ' would wait for', error: { response: { status: 503 }, message: 'Service Unavailable' } },
        { text: ' confirmation.' },
      ]);

      const events = [];
      for await (const ev of (engine as any).streamContinuation({ partial: PARTIAL })) events.push(ev);

      const streamed = events.map((e) => e.data).join('');
      expect(streamed).toBe(' would wait for confirmation.');
      // No duplicated tail: the retry's prefill carries the first attempt's text.
      expect(prompts[1].find((m: { role: string }) => m.role === 'assistant')?.content).toBe(
        `${PARTIAL} would wait for`,
      );
    },
  );

  it('never retries a non-transient failure', async () => {
    const { engine, calls } = engineWithScriptedLlm([
      { error: { status: 401, message: 'Unauthorized' } },
      { text: ' unreachable' },
    ]);

    await expect(
      (async () => {
        for await (const _ of (engine as any).streamContinuation({ partial: PARTIAL })) { /* drain */ }
      })(),
    ).rejects.toMatchObject({ message: 'Unauthorized' });
    expect(calls()).toBe(1);
  });
});