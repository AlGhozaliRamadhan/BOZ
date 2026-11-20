import { describe, expect, it } from 'vitest';
import { WebChatEngine } from '../src/app/api/chat/chat.engine.js';

// The reported reply ended with:
//
//   FAILED VALIDATION: likely-path table missing separated ENTRY column.
//
// as if it were part of the answer. It was the internal answer gate talking to
// itself: the gate is a deterministic checker that can force one regeneration,
// and its rule names are QA vocabulary, not a finding about the market. A
// reader cannot act on "missing separated ENTRY column" and should never have
// to see it. The forced fix still runs; the residual failure goes to the log.

/** An answer that fails the gate on the completeness rule (no final sentence). */
const FAILING_ANSWER = 'the tape is thin and nothing has held a level yet';

function engineWithFailingGate() {
  const engine = new WebChatEngine();
  (engine as any).llm = {
    callWithTools: async () => ({ role: 'assistant', content: FAILING_ANSWER }),
    callTextStream: async function* () {
      yield { type: 'text', text: FAILING_ANSWER };
    },
  };
  (engine as any).checkProviderSetup = () => null;
  return engine;
}

describe('the answer gate stays internal', () => {
  it('never stamps its rule names into the delivered answer', async () => {
    const engine = engineWithFailingGate();
    let answer = '';
    for await (const event of (engine as any).run({
      message: 'why is that happening',
      history: [
        { role: 'user', content: 'intraday nvda' },
        { role: 'assistant', content: 'Waiting for the pullback to hold.' },
      ],
      effort: 'Low',
      thinking: false,
      model: 'test-model',
    })) {
      if (event.type === 'token') answer += event.data;
    }

    // The draft still reaches the user — an answer without its final period is
    // a far smaller failure than a reply that reads like a broken pipeline.
    expect(answer).toContain('nothing has held a level');
    expect(answer).not.toContain('FAILED VALIDATION');
    expect(answer).not.toMatch(/missing separated/i);
    expect(answer).not.toMatch(/answer does not end with a complete sentence/i);
  }, 20000);
});
