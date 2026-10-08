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
});
