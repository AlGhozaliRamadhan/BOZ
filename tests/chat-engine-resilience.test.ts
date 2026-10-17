import { describe, expect, it } from 'vitest';
import { WebChatEngine, isTransientProviderError } from '../src/app/api/chat/chat.engine.js';

// A thinking pass that dies transiently used to sink the whole run: the
// timeline was already streamed, but the draft accumulates internally, so
// Pass 0 failing once meant "Response paused. BOZ did not finish a final
// answer." These tests pin the retry behavior that prevents that.

describe('isTransientProviderError', () => {
  it('retries rate limits, timeouts, and server errors', () => {
    expect(isTransientProviderError({ response: { status: 429 }, message: 'Too Many Requests' })).toBe(true);
    expect(isTransientProviderError({ status: 503, message: 'Service Unavailable' })).toBe(true);
    expect(isTransientProviderError({ status: 500, message: 'Internal Server Error' })).toBe(true);
    expect(isTransientProviderError({ status: 408, message: 'Request Timeout' })).toBe(true);
    expect(isTransientProviderError({ code: 'ECONNRESET', message: 'read ECONNRESET' })).toBe(true);
    expect(isTransientProviderError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' })).toBe(true);
    expect(isTransientProviderError({ message: 'fetch failed' })).toBe(true);
    expect(isTransientProviderError({ message: 'socket hang up' })).toBe(true);
  });

  it('never retries abort, auth, budget, or context-limit failures', () => {
    expect(isTransientProviderError(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isTransientProviderError({ status: 401, message: 'Unauthorized' })).toBe(false);
    expect(isTransientProviderError({ status: 403, message: 'Forbidden' })).toBe(false);
    expect(isTransientProviderError(new Error('LLM-call budget exceeded (18 per request)'))).toBe(false);
    expect(isTransientProviderError(new Error('This model maximum context length is 128000 tokens'))).toBe(false);
    expect(isTransientProviderError(new Error('Invalid API key'))).toBe(false);
    expect(isTransientProviderError(new Error('boom'))).toBe(false);
    expect(isTransientProviderError(null)).toBe(false);
    expect(isTransientProviderError(undefined)).toBe(false);
  });
});

type ScriptStep = { text?: string; error?: unknown };

function engineWithScriptedLlm(script: ScriptStep[]) {
  const engine = new WebChatEngine();
  let calls = 0;
  (engine as any).llm = {
    callTextStream: async function* (_opts: unknown) {
      const step = script[Math.min(calls, script.length - 1)];
      calls++;
      if (step.error) throw step.error;
      if (step.text) yield step.text;
    },
  };
  return { engine, calls: () => calls };
}

const MSGS = [
  { role: 'system', content: 's' },
  { role: 'user', content: 'u' },
] as any;

const transient503 = () => ({ response: { status: 503 }, message: 'Service Unavailable' });

describe('collectThinkingPass', () => {
  it('recovers from one transient failure without losing the run', async () => {
    const { engine, calls } = engineWithScriptedLlm([{ error: transient503() }, { text: 'hello world' }]);
    const text = await (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 1);
    expect(text).toBe('hello world');
    expect(calls()).toBe(2);
  });

  it('discards the failed attempt partial text instead of splicing it', async () => {
    const engine = new WebChatEngine();
    let calls = 0;
    (engine as any).llm = {
      callTextStream: async function* (_opts: unknown) {
        calls++;
        if (calls === 1) {
          yield 'half an ';
          throw transient503();
        }
        yield 'complete answer';
      },
    };
    const text = await (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 1);
    // A resume-mid-text design would produce 'half an complete answer'.
    expect(text).toBe('complete answer');
    expect(calls).toBe(2);
  });

  it('retries an empty pass instead of accepting it as a verdict', async () => {
    const { engine, calls } = engineWithScriptedLlm([{}, { text: 'real answer' }]);
    const text = await (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 1);
    expect(text).toBe('real answer');
    expect(calls()).toBe(2);
  });

  it('gives up after maxRetries and rethrows the last error', async () => {
    const { engine, calls } = engineWithScriptedLlm([{ error: transient503() }, { error: transient503() }]);
    await expect(
      (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 1),
    ).rejects.toMatchObject({ message: 'Service Unavailable' });
    expect(calls()).toBe(2);
  });

  it('does not retry auth failures', async () => {
    const { engine, calls } = engineWithScriptedLlm([
      { error: { status: 401, message: 'Unauthorized' } },
      { text: 'should never be reached' },
    ]);
    await expect(
      (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 2),
    ).rejects.toMatchObject({ message: 'Unauthorized' });
    expect(calls()).toBe(1);
  });

  it('never retries an abort', async () => {
    const { engine, calls } = engineWithScriptedLlm([{ error: new DOMException('aborted', 'AbortError') }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, controller.signal, 2),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls()).toBe(1);
  });

  it(
    'uses the fatal Pass 0 budget (2 retries) to survive back-to-back hiccups',
    { timeout: 20000 },
    async () => {
      const { engine, calls } = engineWithScriptedLlm([
        { error: transient503() },
        { error: { code: 'ECONNRESET', message: 'read ECONNRESET' } },
        { text: 'third time is the charm' },
      ]);
      const text = await (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 2);
      expect(text).toBe('third time is the charm');
      expect(calls()).toBe(3);
    },
  );

  it('honors a provider Retry-After instead of its own backoff', async () => {
    // The provider knows its own quota; the old fixed 1500ms floor ignored it.
    const controller = new AbortController();
    const engine = new WebChatEngine();
    let calls = 0;
    (engine as any).llm = {
      callTextStream: async function* () {
        calls++;
        if (calls === 1) {
          const headers = new Headers({ 'retry-after': '1' });
          throw Object.assign(new Error('slow down'), { status: 429, headers });
        }
        yield 'recovered';
      },
    };
    const started = Date.now();
    const text = await (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, controller.signal, 1);
    expect(text).toBe('recovered');
    // ~1000ms from the header, not the ~500ms local first attempt.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  }, 20000);

  it('interrupts its backoff when the user stops the generation', async () => {
    // The old `setTimeout(1500 * attempt)` was not cancellable, so Stop
    // during a backoff still waited out the full sleep.
    const controller = new AbortController();
    const { engine, calls } = engineWithScriptedLlm([{ error: transient503() }]);
    const pending = (engine as any).collectThinkingPass(
      MSGS, undefined, 'directive', undefined, controller.signal, 3,
    );
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls()).toBe(1);
  }, 20000);
});

describe('generation retry budget', () => {
  it('stops retrying once the whole generation runs out of budget', async () => {
    // MAX_LLM_CALLS is 18 and several sites may retry; without one shared
    // ceiling their budgets compose and a flapping provider bills far more
    // than any single site budget implies.
    const engine = new WebChatEngine();
    (engine as any).retryBudget = { limit: 2, remaining: () => 0, spend: () => false };
    const { engine: scripted, calls } = engineWithScriptedLlm([
      { error: transient503() },
      { error: transient503() },
      { error: transient503() },
      { text: 'never reached' },
    ]);
    (scripted as any).retryBudget = (engine as any).retryBudget;

    await expect(
      (scripted as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 5),
    ).rejects.toMatchObject({ message: 'Service Unavailable' });
    expect(calls()).toBe(1);
  });

  it('resets for each generation', () => {
    const engine = new WebChatEngine();
    expect((engine as any).retryBudget.remaining()).toBeGreaterThan(0);
  });
});

describe('retry notices', () => {
  it('emits a notice before the wait, carrying the code but no message', async () => {
    const notices: any[] = [];
    const { engine } = engineWithScriptedLlm([{ error: transient503() }, { text: 'ok' }]);
    (engine as any).onRetryNotice = (data: any) => notices.push(data);

    await (engine as any).collectThinkingPass(MSGS, undefined, 'directive', undefined, undefined, 1);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ attempt: 1, code: 'SERVER' });
    expect(notices[0].delayMs).toBeGreaterThan(0);
    // A provider message can carry a key or an internal URL.
    expect(JSON.stringify(notices[0])).not.toContain('Service Unavailable');
  }, 20000);
});
