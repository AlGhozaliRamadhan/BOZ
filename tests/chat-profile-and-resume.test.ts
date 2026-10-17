import { describe, expect, it } from 'vitest';
import { WebChatEngine } from '../src/app/api/chat/chat.engine.js';
import { validateChatRequestBody, InvalidRequestBodyError } from '../src/app/lib/api-helpers';
import { RUNTIME_SYSTEM_PROMPT } from '../src/shared/runtime-prompt';

// Two delivery-shape guarantees that are easy to break silently, because both
// live inside one giant prompt string:
//   1. a cut-off run's research reaches the model, so the next turn continues it
//   2. /who gets a research profile, not a forced trade plan
//
// The prompt is captured where the engine assembles it rather than at the LLM
// call: a full run stops at provider preflight in a test environment, which is
// past the point these assertions care about.

function engineWithCapturedSystemPrompt() {
  const engine = new WebChatEngine();
  const build = (engine as any).buildSystemPrompt.bind(engine);
  let captured = '';
  (engine as any).buildSystemPrompt = (...args: unknown[]) => {
    captured = build(...args);
    return captured;
  };
  (engine as any).llm = {
    callWithTools: async () => ({ role: 'assistant', content: '' }),
    callTextStream: async function* () {
      yield 'answer';
    },
  };
  return { engine, systemPrompt: () => captured };
}

async function drain(engine: WebChatEngine, params: Record<string, unknown>) {
  const events = [];
  for await (const ev of (engine as any).run(params)) events.push(ev);
  return events;
}

const RUN_PARAMS = {
  message: '/intraday NVDA',
  history: [],
  effort: 'Medium' as const,
  thinking: false,
  model: 'test-model',
};

describe('interrupted-run context reaches the model', () => {
  it('hands a cut-off run its own unfinished text and completed research', async () => {
    const { engine, systemPrompt } = engineWithCapturedSystemPrompt();
    await drain(engine, {
      ...RUN_PARAMS,
      interrupted: {
        status: 'error',
        question: '/intraday NVDA',
        thoughts: ['tool used: fetch_ticker_dashboard — RSI 61'],
        partial: 'then work the long toward the highs, I',
      },
    });

    const prompt = systemPrompt();
    expect(prompt).toContain('<boz_interrupted_run>');
    expect(prompt).toContain('then work the long toward the highs, I');
    expect(prompt).toContain('tool used: fetch_ticker_dashboard — RSI 61');
    expect(prompt).toContain('instead of restarting');
    // The runtime contract is untouched by this addition.
    expect(prompt).toContain(RUNTIME_SYSTEM_PROMPT.slice(0, 200));
  });

  it('adds nothing when there is no interrupted run', async () => {
    const { engine, systemPrompt } = engineWithCapturedSystemPrompt();
    await drain(engine, RUN_PARAMS);
    expect(systemPrompt()).not.toContain('<boz_interrupted_run>');
  });
});

describe('profile shape for research commands', () => {
  it('waives the trade-plan shape for /who but keeps grounding in force', async () => {
    const { engine, systemPrompt } = engineWithCapturedSystemPrompt();
    await drain(engine, { ...RUN_PARAMS, message: '/who NVDA' });

    const prompt = systemPrompt();
    expect(prompt).toContain('WHEN THE USER ASKS FOR A COMPANY PROFILE');
    expect(prompt).toContain('Do NOT emit the likely-path table, My take');
    expect(prompt).toContain('Legitimacy');
    expect(prompt).toContain('Latest news');
    // Scoped waiver, not a new contract.
    expect(prompt).toContain('waives the DELIVERY shape for this message only');
    expect(prompt).toContain('every other contract stays in force');
    // Grounding survives.
    expect(prompt).toContain('every claim traces to a tool result');
  });

  it('keeps the trade-plan shape for commands that are not research', async () => {
    const { engine, systemPrompt } = engineWithCapturedSystemPrompt();
    await drain(engine, RUN_PARAMS);
    expect(systemPrompt()).not.toContain('WHEN THE USER ASKS FOR A COMPANY PROFILE');
  });
});

describe('interrupted context request validation', () => {
  const base = { message: '/intraday NVDA' };

  it('accepts a well-formed interrupted context', () => {
    const body = validateChatRequestBody({
      ...base,
      interrupted: { status: 'error', question: '/intraday NVDA', thoughts: ['a'], partial: 'b' },
    });
    expect(body.interrupted).toEqual({ status: 'error', question: '/intraday NVDA', thoughts: ['a'], partial: 'b' });
  });

  it('drops an empty context rather than sending a useless block', () => {
    const body = validateChatRequestBody({ ...base, interrupted: { status: 'error', question: '', thoughts: [], partial: '' } });
    expect(body.interrupted).toBeUndefined();
  });

  it('rejects a malformed or oversized context', () => {
    expect(() => validateChatRequestBody({ ...base, interrupted: 'nope' })).toThrow(InvalidRequestBodyError);
    expect(() => validateChatRequestBody({ ...base, interrupted: { status: 'weird' } })).toThrow(InvalidRequestBodyError);
    expect(() => validateChatRequestBody({ ...base, interrupted: { status: 'error', thoughts: new Array(50).fill('x') } }))
      .toThrow(InvalidRequestBodyError);
    expect(() => validateChatRequestBody({ ...base, interrupted: { status: 'error', partial: 'x'.repeat(9_000) } }))
      .toThrow(InvalidRequestBodyError);
  });
});