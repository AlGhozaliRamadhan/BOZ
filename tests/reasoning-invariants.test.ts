import { describe, expect, it } from 'vitest';
import { WebChatEngine } from '../src/app/api/chat/chat.engine.js';
import { EFFORT_PASSES } from '../src/app/api/chat/effort-passes.js';
import { describeReasoningSupport, providerHonorsReasoningEffort, reasoningEffortTransport } from '../src/shared/reasoning-support.js';
import { streamingReasoningPreview, settledReasoningPreview } from '../src/app/components/ui/reasoning-preview';

// These are BEHAVIOURAL pins for invariants that were previously only asserted
// by grepping source text for banned strings. A grep proxy passes while the
// behaviour is broken and breaks on any harmless refactor; every rule here is
// checked by running the thing it describes.

// ─── Pass schedule ───────────────────────────────────────────────────────────

describe('EFFORT_PASSES', () => {
  it('scales verification with the effort tier', () => {
    // Never directly asserted before. This is the tier's real, provider-
    // independent effect, so it is worth pinning precisely.
    expect(EFFORT_PASSES.Low).toBe(1);
    expect(EFFORT_PASSES.Medium).toBe(2);
    expect(EFFORT_PASSES.High).toBe(2);
    expect(EFFORT_PASSES.Extra).toBe(3);
    expect(EFFORT_PASSES.Max).toBe(4);
  });

  it('never gives a higher tier fewer verification passes', () => {
    const ordered = ['Low', 'Medium', 'High', 'Extra', 'Max'] as const;
    for (let i = 1; i < ordered.length; i++) {
      expect(EFFORT_PASSES[ordered[i]], ordered[i]).toBeGreaterThanOrEqual(EFFORT_PASSES[ordered[i - 1]]);
    }
  });
});

// ─── The one-render invariant ────────────────────────────────────────────────

/** One scripted attempt: chunks it emits, and optionally a failure after them. */
interface ScriptedAttempt {
  chunks?: Array<{ type: 'text' | 'reasoning'; text: string }>;
  error?: unknown;
}

/** Installs a scripted adapter that replays attempts in order. */
function scriptAdapter(engine: WebChatEngine, steps: ScriptedAttempt[]): () => number {
  let attempt = 0;
  (engine as any).llm = {
    callTextStream: async function* () {
      const step = steps[Math.min(attempt, steps.length - 1)];
      attempt++;
      for (const chunk of step.chunks ?? []) yield chunk;
      if (step.error !== undefined) throw step.error;
    },
  };
  return () => attempt;
}

const PASS_MESSAGES = [
  { role: 'system' as const, content: 's' },
  { role: 'user' as const, content: 'u' },
];

describe('the one-render invariant', () => {
  it('never yields reasoning as a streamed token', async () => {
    // A pass may only emit `token`. Reasoning rides the engine's own sink, so
    // there is no path by which provider narration can reach the SSE stream as
    // answer text.
    const engine = new WebChatEngine();
    const forwarded: string[] = [];
    (engine as any).onReasoningDelta = (text: string) => forwarded.push(text);
    scriptAdapter(engine, [{
      chunks: [
        { type: 'reasoning', text: 'private deliberation' },
        { type: 'text', text: 'the visible answer' },
      ],
    }]);

    const eventTypes: string[] = [];
    let streamed = '';
    for await (const event of (engine as any).streamThinkingPass(PASS_MESSAGES)) {
      eventTypes.push(event.type);
      if (event.type === 'token') streamed += event.data;
    }

    expect(eventTypes.every((type) => type === 'token')).toBe(true);
    expect(streamed).toBe('the visible answer');
    expect(streamed).not.toContain('private deliberation');
    expect(forwarded.join('')).toContain('private deliberation');
  });

  it('routes provider reasoning to the sink, never into the answer', async () => {
    // The property that makes capturing reasoning safe at all: it is forwarded
    // for display and never concatenated into the text that the next pass, the
    // answer gate, or the user will read.
    const engine = new WebChatEngine();
    const forwarded: string[] = [];
    (engine as any).onReasoningDelta = (text: string) => forwarded.push(text);
    scriptAdapter(engine, [
      {
        // Fails after emitting, so both the reasoning sink and the partial-text
        // discard path are exercised on the same attempt.
        chunks: [
          { type: 'reasoning', text: 'The user asked about a pullback. ' },
          { type: 'text', text: 'partial that is discarded' },
        ],
        error: { status: 503, message: 'Service Unavailable' },
      },
      {
        chunks: [
          { type: 'reasoning', text: 'Second attempt completes.' },
          { type: 'text', text: 'Wait for the dip.' },
        ],
      },
    ]);

    const answer = await (engine as any).collectThinkingPass(
      PASS_MESSAGES, undefined, 'directive', undefined, undefined, 2,
    );

    expect(answer).toBe('Wait for the dip.');
    expect(forwarded.join('')).toContain('pullback');
    expect(answer).not.toContain('pullback');
    expect(answer).not.toContain('Second attempt');
    // The failed attempt's partial text is discarded, not spliced.
    expect(answer).not.toContain('discarded');
  }, 20000);

  it('still keeps a scratchpad inlined inside visible text out of the answer', async () => {
    // Providers with no native reasoning channel inline the scratchpad in
    // `<thinking>` tags. BOZ now SHOWS it, but the guarantee that mattered all
    // along is unchanged: it must never reach the answer.
    const engine = new WebChatEngine();
    const forwarded: string[] = [];
    (engine as any).onReasoningDelta = (text: string) => forwarded.push(text);
    scriptAdapter(engine, [{
      chunks: [{ type: 'text', text: '<think>internal scratchpad</think>Wait for the dip.' }],
    }]);

    const answer = await (engine as any).collectThinkingPass(
      PASS_MESSAGES, undefined, 'directive', undefined, undefined, 1,
    );

    expect(answer).toBe('Wait for the dip.');
    expect(answer).not.toContain('scratchpad');
    // Routed to the thought stream, not silently dropped: that is the change.
    expect(forwarded.join('')).toContain('internal scratchpad');
  }, 20000);
});

// ─── Intent before tools ─────────────────────────────────────────────────────

describe('the panel opens on what the model was trying to do', () => {
  /**
   * A turn whose reasoning explains the call, then a call, then a final answer.
   *
   * `list_skills` is what the model reached for on a bare "hi" in the panel that
   * prompted this: the call was the first thing on screen, with the reasoning
   * that motivated it arriving afterwards.
   */
  function scriptToolRun() {
    const engine = new WebChatEngine();
    const replies = [
      {
        role: 'assistant',
        content: null,
        thought: 'No ticker was named, so there is nothing to analyse yet. I will check what I can offer.',
        tool_calls: [{ id: '1', type: 'function', function: { name: 'list_skills', arguments: '{}' } }],
      },
      { role: 'assistant', content: 'Hey. Which ticker do you want to look at?' },
    ];
    let turn = 0;
    (engine as any).llm = {
      callWithTools: async () => replies[Math.min(turn++, replies.length - 1)],
      callTextStream: async function* () {
        yield { type: 'text', text: 'ok' };
      },
    };
    // Provider preflight is environment state, not the behaviour under test.
    (engine as any).checkProviderSetup = () => null;
    (engine as any).executeTool = async () => 'global: price\nintraday: momentum';
    return engine;
  }

  it('forwards a turn\'s own reasoning before that turn\'s tool call', async () => {
    const engine = scriptToolRun();
    const types: string[] = [];
    for await (const event of (engine as any).run({
      message: 'hi',
      history: [],
      effort: 'Low',
      thinking: true,
      model: 'test-model',
    })) {
      types.push(event.type);
    }

    const reasoningAt = types.indexOf('reasoning');
    const toolAt = types.indexOf('tool_start');
    expect(reasoningAt).toBeGreaterThanOrEqual(0);
    expect(toolAt).toBeGreaterThanOrEqual(0);
    expect(reasoningAt).toBeLessThan(toolAt);
  }, 20000);

  it('says nothing about the run when deep think is off', async () => {
    const engine = scriptToolRun();
    const types: string[] = [];
    for await (const event of (engine as any).run({
      message: 'hi',
      history: [],
      effort: 'Low',
      thinking: false,
      model: 'test-model',
    })) {
      types.push(event.type);
    }

    // The control has to mean something: turning thinking off must not add
    // narration to a run the user asked not to see narrated.
    expect(types).not.toContain('reasoning');
    expect(types).toContain('tool_start');
  }, 20000);
});

// ─── Only the drafting pass is shown ─────────────────────────────────────────

describe('internal passes keep their reasoning to themselves', () => {
  /** A pass whose model narrates "do NOT re-render that report" as it thinks. */
  function engineWithNarration(text: string) {
    const engine = new WebChatEngine();
    (engine as any).llm = {
      callTextStream: async function* () {
        yield { type: 'reasoning', text };
        yield { type: 'text', text: 'the revised answer' };
      },
    };
    const forwarded: string[] = [];
    (engine as any).onReasoningDelta = (chunk: string) => forwarded.push(chunk);
    return { engine, forwarded };
  }

  const REVIEW_NOISE = 'The instructions say: do NOT re-render that report, do NOT re-add the likely-path table or My take.';

  it('shows the drafting pass, because it reasons about the market', async () => {
    const { engine, forwarded } = engineWithNarration('Nobody asked about NVDA, so price first.');
    await (engine as any).collectThinkingPass(PASS_MESSAGES, undefined, 'directive', undefined, undefined, 1);
    expect(forwarded.join('')).toContain('price first');
  });

  it('hides a review pass, because its reasoning is BOZ reviewing its own plumbing', async () => {
    // This is the leak the user reported: the panel filled with the review
    // prompt's own prohibitions, which say nothing about the market.
    const { engine, forwarded } = engineWithNarration(REVIEW_NOISE);
    await (engine as any).collectThinkingPass(
      PASS_MESSAGES, undefined, 'directive', undefined, undefined, 1, false,
    );
    expect(forwarded).toHaveLength(0);
  });

  it('never streams that reasoning as answer text either', async () => {
    const { engine } = engineWithNarration(REVIEW_NOISE);
    const answer = await (engine as any).collectThinkingPass(
      PASS_MESSAGES, undefined, 'directive', undefined, undefined, 1, false,
    );
    expect(answer).toBe('the revised answer');
    expect(answer).not.toContain('likely-path table');
  });
});

// ─── A greeting is a greeting ────────────────────────────────────────────────

describe('a social message gets no toolbox and no analysis contract', () => {
  /** Runs a greeting with a scripted answer and reports what was sent. */
  async function runGreeting(message = 'hi') {
    const engine = new WebChatEngine();
    let sentTools: object[] | undefined;
    let sentMessages: Array<{ role: string; content: string }> = [];
    (engine as any).llm = {
      callWithTools: async (opts: { messages: Array<{ role: string; content: string }>; tools: object[] }) => {
        sentTools = opts.tools;
        sentMessages = opts.messages;
        return { role: 'assistant', content: 'Hey. Which ticker do you want to look at?' };
      },
      callTextStream: async function* () {
        yield { type: 'text', text: 'unused' };
      },
    };
    (engine as any).checkProviderSetup = () => null;
    const types: string[] = [];
    for await (const event of (engine as any).run({
      message,
      history: [],
      effort: 'Max',
      thinking: true,
      model: 'test-model',
    })) {
      types.push(event.type);
    }
    return {
      types,
      sentTools,
      systemPrompt: sentMessages.find((m) => m.role === 'system')?.content ?? '',
    };
  }

  it('sends no tool definitions, so there is nothing for it to call', async () => {
    const { sentTools, types } = await runGreeting();
    expect(sentTools).toEqual([]);
    // The `list_skills` row that opened the panel for a bare "hi" is gone: no
    // tool ran, so no tool is logged.
    expect(types).not.toContain('tool_start');
    expect(types).not.toContain('tool_result');
    expect(types).toContain('token');
  }, 20000);

  it('sends a short system prompt with none of the analysis contracts in it', async () => {
    // The visible thinking recited the delivery contract because the contract
    // was in the prompt. Removing it removes the recitation with it.
    const { systemPrompt } = await runGreeting();
    expect(systemPrompt).toContain('one or two sentences');
    expect(systemPrompt).not.toContain('likely-path table');
    expect(systemPrompt).not.toContain('risk_calc');
    expect(systemPrompt).not.toContain('RUNTIME');
    expect(systemPrompt.length).toBeLessThan(700);
  }, 20000);

  it('still offers tools for a follow-up question about the previous answer', async () => {
    const engine = new WebChatEngine();
    let sentTools: object[] | undefined;
    (engine as any).llm = {
      callWithTools: async (opts: { tools: object[] }) => {
        sentTools = opts.tools;
        return { role: 'assistant', content: 'You asked why the read flipped: the invalidation printed.' };
      },
      callTextStream: async function* () {
        yield { type: 'text', text: 'unused' };
      },
    };
    (engine as any).checkProviderSetup = () => null;

    const events = [];
    for await (const event of (engine as any).run({
      message: 'why did you say that?',
      history: [{ role: 'user', content: 'intraday nvda' }, { role: 'assistant', content: 'Waiting for the pullback.' }],
      effort: 'Medium',
      thinking: true,
      model: 'test-model',
    })) events.push(event);

    expect(sentTools?.length).toBeGreaterThan(0);
  }, 20000);
});

// ─── Effort honesty ──────────────────────────────────────────────────────────

describe('reasoning support by provider', () => {
  it('sends reasoning_effort only where the provider acts on it', () => {
    // Before this table existed, effort reached GitHub and NVIDIA only, so the
    // picker silently did nothing on every other route.
    expect(providerHonorsReasoningEffort('openai')).toBe(true);
    expect(providerHonorsReasoningEffort('groq')).toBe(true);
    expect(providerHonorsReasoningEffort('openrouter')).toBe(true);
    expect(providerHonorsReasoningEffort('custom')).toBe(true);
    expect(providerHonorsReasoningEffort('github')).toBe(true);
    // NVIDIA uses a budget parameter, not this key.
    expect(providerHonorsReasoningEffort('nvidia')).toBe(false);
    expect(reasoningEffortTransport('nvidia')).toBe('budget');
    expect(providerHonorsReasoningEffort('anthropic')).toBe(false);
    expect(providerHonorsReasoningEffort('offline')).toBe(false);
  });

  it('treats an unknown provider as having no reasoning control', () => {
    // Offering a control that cannot do what it says is the failure mode this
    // whole module exists to prevent.
    expect(reasoningEffortTransport('something-new')).toBe('none');
    expect(providerHonorsReasoningEffort('something-new')).toBe(false);
  });

  it('never claims the effort tier is useless', () => {
    // The tier always changes BOZ's own pass count, on every provider. Only
    // the model's thinking budget is conditional.
    for (const provider of ['openai', 'nvidia', 'anthropic', 'offline', 'unknown']) {
      const support = describeReasoningSupport(provider);
      expect(support.note.length).toBeGreaterThan(0);
      expect(support.note).toMatch(/passes|verif/i);
    }
  });

  it('names the limitation honestly for routes without reasoning control', () => {
    expect(describeReasoningSupport('anthropic').honorsEffort).toBe(false);
    expect(describeReasoningSupport('anthropic').note).toMatch(/no reasoning control/i);
    expect(describeReasoningSupport('openai').honorsEffort).toBe(true);
  });
});