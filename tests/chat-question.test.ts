import { describe, expect, it } from 'vitest';
import { WebChatEngine } from '../src/app/api/chat/chat.engine.js';
import { isPlainQuestion, lastAnswer } from '../src/shared/chat-question.js';

// Regression cover for "chat did not reset": after a full report, a question
// about that report came back as the same report again. The engine had three
// independent causes — the drafting pass could not see the prior answer, the
// research chain force-armed itself on any ticker message, and the answer gate
// demanded the report shape. These tests pin the two engine-side fixes and the
// classifier that decides which is which.

const PRIOR_REPORT = "I'm leaning bullish on NVDA with medium conviction, waiting for a pullback to hold.";
const QUESTION = 'but it goes down how could you sure that';

const HISTORY = [
  { role: 'user' as const, content: '/intraday NVDA' },
  { role: 'assistant' as const, content: PRIOR_REPORT },
];

const MESSAGES = [
  { role: 'system', content: 's' },
  { role: 'user', content: '/intraday NVDA' },
  { role: 'assistant', content: PRIOR_REPORT },
  { role: 'user', content: QUESTION },
] as any;

const LEDGER = [] as any;

describe('lastAnswer', () => {
  it('returns the most recent non-empty answer BOZ gave', () => {
    expect(lastAnswer(HISTORY)).toBe(PRIOR_REPORT);
    expect(
      lastAnswer([
        { role: 'assistant', content: 'older' },
        { role: 'assistant', content: 'newest' },
      ]),
    ).toBe('newest');
  });

  it('skips empty and whitespace-only answers', () => {
    expect(
      lastAnswer([
        { role: 'assistant', content: 'real answer' },
        { role: 'assistant', content: '   ' },
      ]),
    ).toBe('real answer');
  });

  it('returns null with no history or no answer yet', () => {
    expect(lastAnswer(undefined)).toBeNull();
    expect(lastAnswer([])).toBeNull();
    expect(lastAnswer([{ role: 'user', content: '/intraday NVDA' }])).toBeNull();
  });
});

describe('isPlainQuestion — the reported message', () => {
  it('classifies the screenshot question as a plain question', () => {
    expect(isPlainQuestion(QUESTION, HISTORY)).toBe(true);
  });

  it('classifies ordinary conversational follow-ups as plain questions', () => {
    for (const message of [
      'why did participation drop on that reclaim',
      'what if it closes below the medium average?',
      'so what invalidates the base path',
      'explain the 0.78x participation number',
      'I am not convinced, how do you justify that stop',
      'then what happens if volume does not expand',
    ]) {
      expect(isPlainQuestion(message, HISTORY), message).toBe(true);
    }
  });
});

describe('isPlainQuestion — asking for a new report is never a plain question', () => {
  it('rejects the first message of a conversation (nothing to ask about yet)', () => {
    expect(isPlainQuestion('/intraday NVDA', [])).toBe(false);
    expect(isPlainQuestion('why is NVDA up', [])).toBe(false);
  });

  it('rejects slash commands even with a previous answer in history', () => {
    expect(isPlainQuestion('/intraday NVDA', HISTORY)).toBe(false);
    expect(isPlainQuestion('/longterm AAPL', HISTORY)).toBe(false);
  });

  it('rejects explicit "do it again" phrasing', () => {
    for (const message of [
      'rerun the intraday analysis for NVDA',
      'start over with a full analysis',
      'give me a fresh analysis from scratch',
      'run a full report again please',
    ]) {
      expect(isPlainQuestion(message, HISTORY), message).toBe(false);
    }
  });

  it('rejects a long structured request', () => {
    const long = `Give me a complete intraday breakdown of NVDA covering the moving averages, `
      + `the RSI and MACD readings, the OBV divergence, the volume participation versus the `
      + `twenty day average, the macro regime, the support and resistance levels, the ATR `
      + `and the sizing for a risk defined position with explicit entry stop and targets.`;
    expect(long.split(/\s+/).length).toBeGreaterThan(40);
    expect(isPlainQuestion(long, HISTORY)).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(isPlainQuestion('', HISTORY)).toBe(false);
    expect(isPlainQuestion('   ', HISTORY)).toBe(false);
  });

  it('does not fire when the previous answer is empty', () => {
    expect(isPlainQuestion('why is that happening', [{ role: 'assistant', content: '' }])).toBe(false);
  });
});

describe('buildQuestionContext — the previous answer reaches the drafting pass', () => {
  it('places the immediately preceding answer before the message being asked about', () => {
    const { context, priorAnswer } = (new WebChatEngine() as any).buildQuestionContext(MESSAGES, true);
    expect(priorAnswer).toBe(PRIOR_REPORT);
    expect(context.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(context[0].content).toBe('/intraday NVDA');
    expect(context[1].content).toBe(PRIOR_REPORT);
    expect(context[2].content).toBe(QUESTION);
  });

  it('carries the answer in chronological order, not after the question', () => {
    const { context } = (new WebChatEngine() as any).buildQuestionContext(MESSAGES, true);
    const answerAt = context.findIndex((m: any) => m.role === 'assistant');
    const questionAt = context.findIndex((m: any) => m.role === 'user' && m.content === QUESTION);
    expect(answerAt).toBeLessThan(questionAt);
  });

  it('carries only the LAST answer, never the whole transcript', () => {
    const many = [
      { role: 'user', content: '/intraday AAPL' },
      { role: 'assistant', content: 'FIRST REPORT' },
      { role: 'user', content: 'and for NVDA' },
      { role: 'assistant', content: 'SECOND REPORT' },
      { role: 'user', content: QUESTION },
    ];
    const { context, priorAnswer } = (new WebChatEngine() as any).buildQuestionContext(many, true);
    expect(priorAnswer).toBe('SECOND REPORT');
    expect(JSON.stringify(context)).not.toContain('FIRST REPORT');
  });

  it('a new report keeps the anti-restatement guard: user messages only', () => {
    // The original design fed NO prior renders back, because replaying the
    // transcript taught the model to restate the report. That must still hold
    // for a fresh report — only a question earns the previous answer.
    const { context, priorAnswer } = (new WebChatEngine() as any).buildQuestionContext(MESSAGES, false);
    expect(priorAnswer).toBeNull();
    expect(context.map((m: any) => m.role)).toEqual(['user', 'user']);
    expect(JSON.stringify(context)).not.toContain(PRIOR_REPORT);
  });

  it('degrades to user messages only when there is no previous answer', () => {
    const fresh = [
      { role: 'system', content: 's' },
      { role: 'user', content: '/intraday NVDA' },
    ];
    const { context, priorAnswer } = (new WebChatEngine() as any).buildQuestionContext(fresh, true);
    expect(priorAnswer).toBeNull();
    expect(context.map((m: any) => m.role)).toEqual(['user']);
  });
});

describe('buildReasoningMessages — the drafting task matches what was asked', () => {
  const engine = new WebChatEngine() as any;

  it('a new report still gets the full-brief synthesis instruction', () => {
    const built = engine.buildReasoningMessages(MESSAGES, LEDGER, '', false);
    const task = built[built.length - 1].content;
    expect(task).toContain('Synthesize the data into a decision-ready conclusion');
    expect(task).toContain('likely-path table');
    expect(task).not.toContain('a question about the answer you gave immediately above');
    expect(built[0].content).not.toContain('WHEN THE USER ASKS YOU A QUESTION');
  });

  it('a plain question gets the scoped instruction and the previous answer', () => {
    const built = engine.buildReasoningMessages(MESSAGES, LEDGER, '', true);
    const task = built[built.length - 1].content;
    expect(task).toContain('a question about the answer you gave immediately above');
    expect(task).toContain('Answer THAT question directly');
    expect(task).not.toContain('Synthesize the data into a decision-ready conclusion');
    expect(built[0].content).toContain('WHEN THE USER ASKS YOU A QUESTION ABOUT YOUR PREVIOUS ANSWER');
    // The answer under discussion has to be visible in the pass context.
    expect(JSON.stringify(built)).toContain(PRIOR_REPORT);
  });
});

describe('buildSelfReviewMessages — every review role stays scoped', () => {
  const engine = new WebChatEngine() as any;

  for (const effort of ['Medium', 'High', 'Extra', 'Max']) {
    it(`${effort} review passes carry the scope guard`, () => {
      const { messages } = engine.buildSelfReviewMessages(
        MESSAGES, LEDGER, 'draft answer', effort, 1, '', '', true,
      );
      const task = messages[messages.length - 1].content;
      expect(task).toContain('answers a question about the answer given immediately above');
      expect(task).toContain('do NOT re-render that report');
    });
  }

  it('a new report is unchanged — no scope guard, no previous answer replayed', () => {
    const { messages } = engine.buildSelfReviewMessages(MESSAGES, LEDGER, 'draft', 'Max', 1);
    const task = messages[messages.length - 1].content;
    expect(task).not.toContain('answers a question about the answer given immediately above');
    expect(JSON.stringify(messages)).not.toContain(PRIOR_REPORT);
  });

  it('a scoped review pass sees the answer being asked about', () => {
    const { messages } = engine.buildSelfReviewMessages(MESSAGES, LEDGER, 'draft', 'Max', 1, '', '', true);
    expect(JSON.stringify(messages)).toContain(PRIOR_REPORT);
  });
});

describe('classification wired to the reported exchange', () => {
  it('the screenshot question is plain; its slash trigger is not', () => {
    expect(isPlainQuestion(QUESTION, HISTORY)).toBe(true);
    expect(isPlainQuestion('/intraday NVDA', HISTORY)).toBe(false);
  });
});