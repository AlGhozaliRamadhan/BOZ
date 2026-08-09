// ─── chat.engine.ts ───────────────────────────────────────────────────────────
// Server-side chat engine for BOZ web app.
// Brings CLI-level intelligence to the browser: tool calling, evidence ledger,
// sub-agent delegation, effort-scaled refinement passes, model fallback, and SSE
// streaming. Higher effort buys more VERIFICATION and more ANGLES (number audit,
// logic review, breadth, independent scenario branches) — not more passes of the
// same critique loop re-inventing unverified figures.

import { LLMAdapter } from '@/services/ai/llm.adapter';
import type { ReasoningEffort } from '@/services/ai/llm.adapter';
import { config } from '@/config/config';
import { yahooFinance } from '@/services/market/yahoo.service';
import { newsFetchService } from '@/services/news/news.fetch.service';
import { SentimentService } from '@/services/market/sentiment.service';
import { webSearchService } from '@/services/search/web.search.service';
import { idxScannerService } from '@/services/market/idx.scanner.service';
import { memoryService } from '@/services/memory.service';
import { resolveSymbolIDX } from '@/shared/market-constants';
import { GITHUB_MODELS } from '@/config/github.config';
import { NVIDIA_MODELS } from '@/config/nvidia.config';
import type { LLMMessage, RawToolCall } from '@/types/llm.types';
import { getThoughtPrompt, type ThoughtEffort } from '@/shared/thought-prompts';
import { formatLedgerFacts } from '@/shared/ledger-facts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatEvent {
  type: 'tool_start' | 'tool_result' | 'reasoning_start' | 'token' | 'done' | 'error' | 'thought' | 'thought_new';
  data: any;
}

interface LedgerEntry {
  step:    number;
  tool:    string;
  fact:    string;
  quality: 'confirmed' | 'partial' | 'empty';
}

interface ParsedToolCall {
  name:      string;
  arguments: Record<string, any>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 15;
const MAX_HISTORY_MESSAGES = 14;

// How many "look again" passes each effort tier gets and what they do.
// Effort scales VERIFICATION and BREADTH, not repetition of the same critique:
//   Medium — the review pass audits the draft's hard numbers, tagging each as
//            tool-verified or illustrative, never inventing a replacement.
//   High   — the review pass checks logic and completeness against the ledger.
//   Extra  — an additional pass widens coverage to more channels/sources.
//   Max    — extra passes run INDEPENDENT scenario branches, synthesized at the end.
// Low gets no review pass at all: single pass, no invented figures.
const EFFORT_PASSES: Record<ThoughtEffort, number> = {
  Low:    1,
  Medium: 2,
  High:   2,
  Extra:  3,
  Max:    5,
};

// Max effort: the refinement passes after the initial draft run INDEPENDENT
// scenario branches — bull, base, bear — each reasoned from the same base draft,
// then a synthesis pass merges them. The final branch must contain 'synthesis'
// so the loop knows which output becomes the answer.
const MAX_SCENARIO_BRANCHES = [
  'Scenarios: bullish',
  'Scenarios: base',
  'Scenarios: bearish',
  'Scenario synthesis',
];

// ─── WebChatEngine ────────────────────────────────────────────────────────────

export class WebChatEngine {
  private llm = new LLMAdapter();
  private sentimentService = new SentimentService();

  // ─── Main entry point ─────────────────────────────────────────────────────
  // Yields streaming ChatEvent objects for the SSE route to emit.

  async *run(params: {
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    effort?: ThoughtEffort;
    thinking?: boolean;
  }): AsyncGenerator<ChatEvent> {
    const { message, history } = params;
    const effort: ThoughtEffort = params.effort ?? 'Max';
    const thinkingEnabled = params.thinking !== false;

    // Map ThoughtEffort → native reasoning_effort for backend
    const reasoningEffort: ReasoningEffort | undefined = thinkingEnabled
      ? (effort === 'Low' ? 'low' : effort === 'Medium' ? 'medium' : 'high')
      : undefined;

    // Prefill text — forces the model to start generating inside <think>
    const PREFILL = '<think>\nThinking Process:\n1. ';

    // ── Build message list ──────────────────────────────────────────────────
    const messages: LLMMessage[] = [
      { role: 'system', content: this.buildSystemPrompt(effort, thinkingEnabled) },
    ];

    if (history?.length) {
      for (const msg of history.slice(-MAX_HISTORY_MESSAGES)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    // ── First AI call — with tools (and prefill trap on the first call) ─────
    let aiMessage: LLMMessage;
    try {
      aiMessage = await this.callWithFallback(
        messages,
        this.getToolDefinitions(),
        0.3,
        { reasoningEffort, assistantPrefill: thinkingEnabled ? PREFILL : undefined },
      );
      if (aiMessage.thought) {
        yield { type: 'thought', data: aiMessage.thought };
      }
    } catch (err) {
      yield { type: 'error', data: { message: err instanceof Error ? err.message : 'AI call failed' } };
      return;
    }

    // ── Evidence ledger ─────────────────────────────────────────────────────
    const ledger: LedgerEntry[] = [];
    let step = 0;
    let toolRounds = 0;

    // ── Tool-calling loop ───────────────────────────────────────────────────
    while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      toolRounds++;
      if (toolRounds > MAX_TOOL_ROUNDS) break;

      messages.push(aiMessage);

      // Emit tool_start events for all tools in this round
      const parsed: Array<{ raw: RawToolCall; call: ParsedToolCall }> = [];
      for (const raw of aiMessage.tool_calls) {
        const call = this.parseToolCall(raw);
        parsed.push({ raw, call });
        yield {
          type: 'tool_start',
          data: { tool: call.name, args: call.arguments, step: step + parsed.length },
        };
      }

      // Execute all tool calls concurrently
      const results = await Promise.all(
        parsed.map(async ({ raw, call }) => {
          let obs: string;
          let success = true;
          try {
            obs = await this.executeTool(call.name, call.arguments, messages, ledger, effort);
            if (obs.includes('Tool execution failed') || obs.includes('returned no results') || obs.includes('No news found')) {
              success = false;
            }
          } catch (e) {
            success = false;
            obs = 'Tool execution failed: ' + (e instanceof Error ? e.message : String(e));
          }
          return { raw, call, obs, success };
        }),
      );

      // Process results: extract facts, emit events, push tool messages
      for (const { raw, call, obs, success } of results) {
        step++;
        const fact = this.extractFact(call.name, call.arguments, obs);
        if (fact) {
          fact.step = step;
          ledger.push(fact);
        }

        yield {
          type: 'tool_result',
          data: {
            tool:    call.name,
            fact:    fact?.fact || obs.slice(0, 120),
            quality: fact?.quality || 'empty',
            step,
            success,
          },
        };

        messages.push({
          role:         'tool',
          content:      obs,
          name:         call.name,
          tool_call_id: raw.id,
        });
      }

      // Next AI call — decide if more tools or final answer (no prefill after first round)
      try {
        aiMessage = await this.callWithFallback(
          messages,
          this.getToolDefinitions(),
          0.3,
          { reasoningEffort },
        );
        if (aiMessage.thought) {
          yield { type: 'thought', data: aiMessage.thought };
        }
      } catch (err) {
        yield { type: 'error', data: { message: err instanceof Error ? err.message : 'AI follow-up call failed' } };
        return;
      }
    }

    // ── Final response ──────────────────────────────────────────────────────
    // Multi-pass thinking: at higher effort the model genuinely "looks again" —
    // each pass streams a fresh numbered thinking block, then re-examines its
    // own draft and produces a refined answer. The frontend renders each
    // thought_new as a separate step, so the user sees the iterative loop.
    if (ledger.length > 0 || aiMessage.content) {
      const confirmedCount = ledger.filter(e => e.quality === 'confirmed').length;
      yield { type: 'reasoning_start', data: { confirmedFacts: confirmedCount, totalSteps: step } };

      // Passes to run. Deep Think OFF or Low effort → single pass (unchanged
      // behaviour). Higher effort → more passes, each with a different job
      // (audit numbers, then logic, then breadth, then scenario branches).
      const passes = thinkingEnabled ? EFFORT_PASSES[effort] : 1;

      let draft = '';
      // Max scenario branches each build on the SAME pass-0 draft (independent
      // paths), accumulate separately, and are merged only by the synthesis pass.
      let baseDraft = '';
      let branchDrafts = '';
      try {
        // ── Pass 0: initial synthesis (research) or use the direct answer ─────
        // NOTE: pass tokens are accumulated internally, NOT streamed to the UI.
        // The user sees every thinking step, but only the FINAL refined draft is
        // streamed as the visible answer at the bottom — so the reply is one
        // coherent answer, never a concatenation of every pass's draft.
        if (ledger.length > 0) {
          const reasoningMessages = this.buildReasoningMessages(messages, ledger);
          for await (const ev of this.streamThinkingPass(reasoningMessages, reasoningEffort, getThoughtPrompt(effort))) {
            if (ev.type === 'token') draft += ev.data;
            else yield ev;
          }
        } else if (aiMessage.content) {
          draft = this.stripThinkingFull(aiMessage.content);
        }

        // ── Passes 1..N: effort-scaled refinement passes ─────────────────────
        // Each pass has a SPECIFIC JOB instead of re-running the same critique:
        //   Medium pass 1 — audit every hard number: tool-verified or illustrative.
        //   High   pass 1 — check logic and completeness against the ledger.
        //   Extra  passes — add channel/source breadth after the audit.
        //   Max    passes — run INDEPENDENT scenario branches (bull/base/bear),
        //                    each reasoned from the SAME base draft, then a
        //                    synthesis pass merges them.
        // Only the thoughts stream to the UI; the refined draft is kept internal.
        // If a pass fails (context overflow, provider hiccup), keep the last good
        // draft and deliver the answer instead of erroring the stream.
        baseDraft = draft;
        for (let pass = 1; pass < passes; pass++) {
          let passMessages: LLMMessage[];
          let thoughtMsg: string;
          // The input every pass builds on: branches use the fixed base draft so
          // they stay independent; the synthesis pass sees all branches.
          const isSynthesisPass = MAX_SCENARIO_BRANCHES[pass - 1]?.includes('synthesis');
          // Branches build on the fixed base draft so they stay independent; the
          // synthesis pass sees every branch plus the base.
          const passInput = effort === 'Max'
            ? isSynthesisPass
              ? branchDrafts
              : baseDraft
            : draft;

          if (effort === 'Max') {
            const scenario = MAX_SCENARIO_BRANCHES[pass - 1] ?? `Scenario ${pass}`;
            passMessages = this.buildScenarioMessages(messages, ledger, passInput, scenario);
            thoughtMsg = isSynthesisPass
              ? `Branches are in. Merging them into one answer, weighted by the evidence.`
              : `Branching off: ${scenario}.`;
          } else {
            const review = this.buildSelfReviewMessages(messages, ledger, passInput, effort, pass);
            passMessages = review.messages;
            thoughtMsg = review.thought;
          }

          yield { type: 'thought_new', data: thoughtMsg };
          try {
            let passDraft = '';
            for await (const ev of this.streamThinkingPass(passMessages, reasoningEffort, getThoughtPrompt(effort))) {
              if (ev.type === 'token') passDraft += ev.data;
              else yield ev;
            }
            if (effort === 'Max') {
              // Keep branch outputs separate; the synthesis pass merges them.
              branchDrafts += (passDraft || draft) + '\n';
              // Once the synthesis pass has run, its output becomes the final draft.
              if (isSynthesisPass) {
                draft = passDraft || draft;
              } else {
                draft = baseDraft; // next branch starts from the base, not the last branch
              }
            } else {
              // Feed the refined draft into the next review pass.
              draft = passDraft || draft;
            }
          } catch (passErr) {
            // A failed pass must not destroy the whole reply — keep the last
            // good draft and move on to deliver it.
            console.warn(`[chat.engine] refinement pass ${pass} (${effort}) failed, keeping previous draft:`, passErr instanceof Error ? passErr.message : passErr);
          }
        }

        // ── Final: stream the one, final refined answer at the bottom ─────────
        // The chain of thought stops here — no more thinking after the answer
        // starts. Tokens stream progressively so the reply still feels alive.
        const words = draft.split(/(\s+)/);
        for (const word of words) {
          if (word) {
            yield { type: 'token', data: word };
            await new Promise(r => setTimeout(r, 8));
          }
        }
      } catch (err) {
        yield { type: 'error', data: { message: 'Reasoning agent failed: ' + (err instanceof Error ? err.message : String(err)) } };
        return;
      }
    } else {
      yield { type: 'token', data: 'I couldn\'t generate a response. Please try again.' };
    }

    yield { type: 'done', data: { totalSteps: step } };
  }

  // ─── System prompt (ported from CLI, adapted for web) ─────────────────────

  private buildSystemPrompt(effort: ThoughtEffort = 'Max', includeThoughtDirective = true): string {
    const memory = memoryService.getMemory();
    const prefs = memory.preferences.length
      ? `\nUSER PREFERENCES:\n${memory.preferences.map(p => '  - ' + p).join('\n')}`
      : '';
    const facts = memory.facts.length
      ? `\nUSER FACTS:\n${memory.facts.map(f => '  - ' + f).join('\n')}`
      : '';

    const thoughtDirective = includeThoughtDirective ? getThoughtPrompt(effort) : '';
    const groundingDirective = this.buildGroundingDirective(effort);

    return [
      'You are BOZ (Behavioral Outlook Zone), an elite AI market assistant and quantitative analyst.',
      'You think like a hedge fund analyst — skeptical, data-driven, always asking "is this enough?"',
      prefs,
      facts,
      '',
      groundingDirective,
      '',
      thoughtDirective,
      '',
      'CONVERSATIONAL AI RULES:',
      '  - You have FULL AUTONOMY to decide whether tools are needed.',
      '  - If the user is asking a conceptual, philosophical, code, or follow-up question that does not need live market ticks, answer directly using your deep reasoning chain without calling market tools.',
      '  - If you genuinely need live data, prices, news, or a fresh scan, call the tools.',
      '  - ANTI-LOOP RULE: If you just ran tools 1 turn ago and the user asks a follow-up about',
      '    the SAME topic, it is almost always WRONG to call tools again. Answer from context.',
      '  - COST AWARENESS: Every tool call takes 10-30 seconds. Be frugal.',
      '',
      'TOOLS:',
      '  fetch_price(symbol_or_name)       — live price for any asset',
      '  fetch_news(query, category?)      — market news; query is a free-text search string',
      '  fetch_sentiment()                 — Fear & Greed + StockTwits crowd data',
      '  web_search(query)                 — live web search; use when other tools give nothing',
      '  scan_indonesia_momentum(sector?,  — IDX scanner; screens the full IDX universe',
      '    signal_type?, setup?, scan_mode?)  for momentum candidates. Deep mode is exhaustive.',
      '  update_memory(fact, is_preference)— save long-term user facts or preferences',
      '',
      'THINKING RULES:',
      '  1. After each tool result, reflect: What did I learn? Is this enough? What next?',
      '  2. If a tool returns empty/irrelevant results, pivot to web_search with a better query.',
      '  3. Build a picture iteratively. Each tool call should add NEW information.',
      '  4. You may call 6-10 tools per query if needed. More data = better analysis.',
      '  5. Maintain a global market focus unless the user asks about a specific region.',
      '  6. FOLLOW-UP QUESTIONS: If the user asks about the analysis you JUST provided,',
      '     DO NOT call tools again. Answer directly from the conversation context.',
      '',
      'INDONESIAN STOCK HUNTING RULES:',
      '  - When asked for IDX stocks to buy/invest/watch: ALWAYS call scan_indonesia_momentum.',
      '    Autonomously pick the best setup filter ("rebound", "breakout", "oversold", "momentum").',
      '  - After the scan, call fetch_price on the top 2-3 BUY candidates to confirm live prices.',
      '  - Then call fetch_news WITH THE SPECIFIC COMPANY NAME AND SYMBOL to check for catalysts.',
      '  - If news is irrelevant, call web_search for deep fundamentals.',
      '  - Do NOT just name BBCA/BBRI/TLKM from memory — those are lazy defaults.',
      '  - Cite the score, volume ratio, and 52w range position.',
      '',
      'SUB-AGENT DELEGATION:',
      '  - You have a team: QuantBrain, NewsHound, RiskManager, DataGoblin.',
      '  - For complex analysis, summon 2-3 sub-agents CONCURRENTLY to analyze different angles.',
      '  - Do not try to analyze complex stocks alone. Delegate the heavy thinking.',
      '',
      'EVIDENCE RULES — IMMUTABLE:',
      '  - Facts confirmed from tool results are locked. You cannot contradict them.',
      '  - If price data says +1.1%, your analysis must reflect that.',
      '  - If news returned nothing, say exactly that. Do not invent headlines.',
      '',
      'CONTRARIAN ANALYSIS:',
      '  - StockTwits >70% bullish = caution (retail euphoria precedes reversals)',
      '  - StockTwits <30% bullish = buy signal (panic = opportunity)',
      '  - Fear & Greed >75 = reduce long confidence',
      '  - Fear & Greed <25 = strong buy signal',
      '',
      'OUTPUT FORMAT:',
      '  - Reply in a natural, conversational style. Direct, confident, professional.',
      '  - Use rich markdown formatting: **bold**, headers, bullet lists, tables, code blocks.',
      '  - For stock recommendations: rank your picks, give entry zone, stop-loss, and reasoning.',
      '  - Cite data and reasoning, never vague hand-waving.',
      '  - Acknowledge uncertainty honestly.',
      '  - Never pad with filler. Be sharp and direct.',
      '  - Rarely use emojis.',
    ].join('\n');
  }

  // ─── Effort-scaled grounding directive ────────────────────────────────────
  // Injected into the tool-gathering system prompt so figures get grounded BEFORE
  // drafting. Effort buys verification and breadth, not more confident guesses:
  //   Low/Medium — never invent a figure; tag every number tool-verified or
  //                illustrative; a number that matters IS a search trigger.
  //   High        — figures anchoring the argument must come from tool results.
  //   Extra/Max   — cross-check diverging figures against 2+ sources and cover
  //                multiple transmission channels, not just the headline one.
  private buildGroundingDirective(effort: ThoughtEffort): string {
    const base = [
      'GROUNDING RULES:',
    ];
    if (effort === 'Low') {
      base.push(
        '  - If a specific number matters to your answer and you do not have a confirmed tool result for it, do NOT invent it.',
        '  - Say "illustrative" and give a range instead, or keep the point qualitative.',
      );
    } else if (effort === 'Medium') {
      base.push(
        '  - Tag every hard number you use as TOOL-VERIFIED (from a tool result) or ILLUSTRATIVE (your estimate).',
        '  - If a number matters to the argument and is not tool-verified, call a tool to get it — never guess a better number.',
      );
    } else if (effort === 'High') {
      base.push(
        '  - The figures anchoring your argument (rates, prices, spreads, levels) must come from tool results in this conversation.',
        '  - Anything else is "illustrative" — an approximate range, never a point value.',
        '  - If a figure matters and is unverified, search for it before drafting. Do not refine your guess.',
      );
    } else {
      // Extra / Max
      base.push(
        '  - Anchor every key figure to a tool result. Where figures can diverge (rates, estimates, vendor data), cross-check against at least two sources.',
        '  - Cover multiple transmission channels (rates, FX, commodities, USD-debt exposure, passive/institutional flows, retail share, fiscal-monetary interaction) at a level the confirmed facts support.',
        '  - PRE-FETCH THE USUAL SUSPECTS NOW, in the tool phase, while you still can: for a macro-market analysis, get the figures the later breadth/scenario passes will need — rates, yield spreads, FX, foreign ownership %, corporate foreign-currency debt exposure, retail participation, sector weights. Gather them upfront so the deeper passes verify against the ledger instead of flagging gaps that could have been fetched once.',
        '  - Point-in-time numbers are stated only when two sources agree or one is primary (central bank, exchange). Diverging figures are a range with sources named.',
        '  - Estimates are explicitly labelled ILLUSTRATIVE.',
      );
    }
    return base.join('\n');
  }

  // ─── Tool definitions ─────────────────────────────────────────────────────

  private getToolDefinitions(): object[] {
    return [
      {
        type: 'function',
        function: {
          name: 'update_memory',
          description: 'Save a persistent fact or preference about the user across sessions.',
          parameters: {
            type: 'object',
            properties: {
              fact: { type: 'string', description: 'The fact or preference to save.' },
              is_preference: { type: 'boolean', description: 'True if rule/preference, false if general fact.' },
            },
            required: ['fact', 'is_preference'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'summon_agent',
          description: 'Summon a specialized sub-agent for complex analysis. Use for deep-thinking tasks.',
          parameters: {
            type: 'object',
            properties: {
              agent_name: {
                type: 'string',
                enum: ['NewsHound', 'DataGoblin', 'QuantBrain', 'RiskManager'],
                description: 'Which agent to summon.',
              },
              task: { type: 'string', description: 'The specific task and data to analyze.' },
            },
            required: ['agent_name', 'task'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_price',
          description: 'Fetch live market price for any asset — stocks, indices, crypto, forex, commodities.',
          parameters: {
            type: 'object',
            properties: {
              symbol_or_name: {
                type: 'string',
                description: 'Ticker or name. E.g.: BTC, AAPL, IHSG, BBCA, GOLD, EURUSD',
              },
            },
            required: ['symbol_or_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_news',
          description: [
            'Fetch recent market news using a free-text search query.',
            'Checks Indonesian RSS feeds (CNBC Indonesia, Bisnis.com, Kontan, Detik Finance)',
            'as well as global sources.',
            'If this returns empty, follow up with web_search.',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Free-text search. Use local language terms for Indonesian assets.',
              },
              category: {
                type: 'string',
                enum: ['crypto', 'stocks', 'macro', 'broad', 'indonesia'],
                description: 'Optional category hint.',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch_sentiment',
          description: 'Fetch global crowd sentiment — CNN Fear & Greed index + StockTwits crowd ratio.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: [
            'Search the live web for current information.',
            'Use when other tools return empty or insufficient results.',
            'Useful for: market news, sector analysis, macro events, company news.',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query.' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'scan_indonesia_momentum',
          description: [
            'Scan the IDX universe for hidden momentum setups.',
            'Fast mode quote-screens all IDX stocks then chart-scans the strongest.',
            'Deep mode chart-scans every valid IDX quote for exhaustive coverage.',
            'Returns ranked BUY candidates and WATCH list sorted by score.',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              sector: {
                type: 'string',
                enum: ['all', 'banking', 'consumer', 'mining', 'energy', 'tech', 'property', 'telecom', 'healthcare', 'industrial'],
                description: 'Filter by sector.',
              },
              signal_type: {
                type: 'string',
                enum: ['buy', 'sell', 'any'],
                description: '"buy" for positive momentum, "sell" for deteriorating, "any" for all.',
              },
              setup: {
                type: 'string',
                enum: ['momentum', 'rebound', 'all_time_low', 'downtrend', 'breakout', 'oversold'],
                description: 'Filter by setup type. Pick the best one based on market context.',
              },
              scan_mode: {
                type: 'string',
                enum: ['fast', 'deep'],
                description: '"fast" (default) quote-screens first. "deep" is exhaustive.',
              },
            },
            required: [],
          },
        },
      },
    ];
  }

  // ─── Tool executor ────────────────────────────────────────────────────────

  private async executeTool(
    name: string,
    args: Record<string, any>,
    messages: LLMMessage[],
    ledger: LedgerEntry[],
    effort?: ThoughtEffort,
  ): Promise<string> {
    switch (name) {

      case 'summon_agent': {
        const agentName = (args.agent_name as string) ?? 'UnknownAgent';
        const task = (args.task as string) ?? '';
        return await this.simulateSubAgent(agentName, task, messages, ledger, effort);
      }

      case 'fetch_price': {
        const raw    = args.symbol_or_name as string;
        const symbol = resolveSymbolIDX(raw) || raw.toUpperCase();
        const quote  = await this.retrySimple(() => yahooFinance.quote(symbol), 3, 2000);
        const price  = (quote as any).regularMarketPrice;
        const change = (quote as any).regularMarketChangePercent;
        if (price === undefined || price === null) {
          return `No price data for ${symbol}. Yahoo Finance may not support this symbol or market is closed.`;
        }
        const chgNum    = typeof change === 'number' ? change : 0;
        const name_     = (quote as any).shortName || (quote as any).longName || symbol;
        const dayHigh   = (quote as any).regularMarketDayHigh;
        const dayLow    = (quote as any).regularMarketDayLow;
        const prevClose = (quote as any).regularMarketPreviousClose;
        return [
          `Symbol: ${symbol} | Name: ${name_} | Price: ${price} (Change: ${chgNum.toFixed(2)}%)`,
          dayHigh  != null ? `Day Range: ${dayLow} – ${dayHigh}` : '',
          prevClose != null ? `Prev Close: ${prevClose}` : '',
        ].filter(Boolean).join(' | ');
      }

      case 'update_memory': {
        const fact   = (args.fact as string) ?? '';
        const isPref = (args.is_preference as boolean) ?? false;
        if (isPref) { memoryService.addPreference(fact); }
        else        { memoryService.addFact(fact); }
        return `Successfully saved memory: ${fact}`;
      }

      case 'fetch_news': {
        const query    = (args.query as string) ?? '';
        const category = (args.category as string) ?? 'broad';
        const items: string[] = [];

        const fetchers: Promise<any[]>[] = [];
        if (category === 'indonesia' || category === 'stocks' || category === 'broad') {
          fetchers.push(newsFetchService.fetchIndonesiaNews().catch(() => []));
        }
        if (category === 'crypto') {
          fetchers.push(newsFetchService.fetchCryptoNews().catch(() => []));
        }
        if (category === 'stocks' || category === 'broad') {
          fetchers.push(newsFetchService.fetchStockNews().catch(() => []));
          fetchers.push(newsFetchService.fetchBroadMarketNews().catch(() => []));
        }
        if (category === 'macro') {
          fetchers.push(newsFetchService.fetchMacroNews().catch(() => []));
          fetchers.push(newsFetchService.fetchBroadMarketNews().catch(() => []));
        }
        if (fetchers.length === 0) {
          fetchers.push(newsFetchService.fetchBroadMarketNews().catch(() => []));
          fetchers.push(newsFetchService.fetchIndonesiaNews().catch(() => []));
        }

        const settled = await Promise.all(fetchers);
        const fetched: any[] = settled.flat();

        // Relevance scoring against query
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const scored = fetched
          .map(n => {
            const title = (n.title ?? '').toLowerCase();
            const blob  = `${title} ${n.details ?? ''} ${(n.assets ?? []).join(' ')} ${n.source ?? ''}`.toLowerCase();
            let score = 0;
            for (const w of queryWords) {
              if (title.includes(w)) score += 2;
              else if (blob.includes(w)) score += 1;
            }
            return { n, score };
          })
          .filter(({ score }) => queryWords.length === 0 || score > 0)
          .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const imp: Record<string, number> = { high: 2, medium: 1, low: 0 };
            return (imp[b.n.impact] ?? 0) - (imp[a.n.impact] ?? 0);
          })
          .slice(0, 10);

        for (const { n } of scored) {
          const src = n.source ? ` (${n.source})` : '';
          items.push(`- ${n.title}${src}`);
        }

        if (items.length === 0) {
          return `No news found for "${query}". [HINT: call web_search with query "${query}" to get live results]`;
        }
        return items.join('\n');
      }

      case 'fetch_sentiment': {
        const data = await this.sentimentService.fetchCrowdSentiment();
        return JSON.stringify({
          fear_greed:      data.fear_greed,
          reddit_buzz:     { stocktwits: data.stocktwits_data ?? null, social: data.social_buzz ?? [] },
          overall_signals: data.summary.overall_signals,
        }, null, 2);
      }

      case 'web_search': {
        const query = (args.query as string) ?? '';
        // Effort-scaled depth: Low/Medium get a headline-tier search, High+ get
        // deepSearch which fetches the top pages and RAG-extracts their content.
        const depth = effort === 'Low' || effort === 'Medium' ? 1 : effort === 'High' ? 2 : 3;
        return await webSearchService.deepSearch(query, depth);
      }

      case 'scan_indonesia_momentum': {
        const sector     = (args.sector      as string) ?? 'all';
        const signalType = (args.signal_type  as string) ?? 'buy';
        const setup      = (args.setup        as string) ?? 'momentum';
        const scanMode   = (args.scan_mode    as string) ?? 'fast';
        const result     = await idxScannerService.scan(
          sector as any, signalType as any, setup as any, scanMode as any,
        );
        return result.formatted;
      }

      default:
        return 'Unknown tool: ' + name;
    }
  }

  // ─── Sub-agent simulation ─────────────────────────────────────────────────

  private async simulateSubAgent(
    agentName: string,
    task:      string,
    conversationMessages: LLMMessage[],
    ledger:    LedgerEntry[],
    effort?: ThoughtEffort,
  ): Promise<string> {
    const lower = agentName.toLowerCase();
    let persona: string;

    if (lower === 'quantbrain') {
      persona = 'You are QuantBrain, a ruthless quantitative analyst. You focus PURELY on mathematics, risk-reward ratios, technicals, and volume flow. You ignore sentiment and hype. Give a highly empirical, data-dense analysis.';
    } else if (lower === 'newshound') {
      persona = 'You are NewsHound, a macro-economic intelligence agent. You read between the lines of global events, institutional money flow, and social sentiment. You connect seemingly unrelated geopolitical or economic events to the asset in question.';
    } else if (lower === 'riskmanager') {
      persona = 'You are RiskManager, a highly skeptical devil\'s advocate and former hedge fund auditor. Your ONLY job is to find reasons NOT to buy. Hunt for hidden red flags, overvaluation, regulatory risks, and structural flaws.';
    } else if (lower === 'datagoblin') {
      persona = 'You are DataGoblin, obsessed with obscure metrics, historical statistical anomalies, and relative valuations. You cross-reference sectors and peer groups to find absolute truths in the numbers.';
    } else {
      persona = `You are ${agentName}, a specialized analysis sub-agent.`;
    }

    const confirmedFacts = ledger
      .filter(e => e.quality === 'confirmed')
      .map(e => `  • ${e.fact}`)
      .join('\n');

    const recentConversation = conversationMessages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls && typeof m.content === 'string' && m.content?.trim())
      .slice(-6)
      .map(m => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 900)}`)
      .join('\n\n');

    // Effort-scaled analysis depth: Low/Medium → single-pass read; High+ → full
    // framework so the sub-agent actively hunts contradictions and hidden risks.
    const depthDirective =
      effort === 'Extra' || effort === 'Max'
        ? 'Reason exhaustively. Attack the obvious conclusion, hunt for contradictions, cross-check every claim, and flag the single biggest risk.'
        : effort === 'High'
          ? 'Reason rigorously. Decompose the problem, weigh at least two angles, and state the main risk in one line.'
          : 'Reason clearly and directly. Give the decisive factors and the main risk.';

    const subAgentMessages: LLMMessage[] = [
      {
        role: 'system',
        content: [
          persona,
          'Your job is to deeply analyze the task below.',
          'You are not allowed to call tools, summon another agent, delegate, or output XML/tool syntax.',
          'Return only your final specialist report in concise Markdown.',
          'Use the provided task, conversation summary, and confirmed data ledger only.',
          'If data is insufficient, say what is missing and still give the best risk-aware view.',
          depthDirective,
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Task: "${task}"`,
          '',
          'RECENT CONVERSATION SUMMARY:',
          recentConversation || '  (none)',
          '',
          'CONFIRMED DATA GATHERED BY BOZ:',
          confirmedFacts || '  (none)',
          '',
          'Output format:',
          `### ${agentName} Report`,
          '- **Thesis:** ...',
          '- **Evidence:** ...',
          '- **Risks / caveats:** ...',
          '- **Actionable conclusion:** ...',
        ].join('\n'),
      },
    ];

    try {
      const report = await this.llm.callText({
        messages:    subAgentMessages,
        temperature: 0.5,
        maxTokens:   2000,
      });
      const cleaned = this.stripThinkingFull(report);
      return `[REPORT FROM ${agentName}]\n${cleaned || 'Sub-agent returned no usable report.'}`;
    } catch (e) {
      return `Failed to summon ${agentName}: ` + (e instanceof Error ? e.message : String(e));
    }
  }

  // ─── Evidence ledger builder ──────────────────────────────────────────────

  private extractFact(toolName: string, args: Record<string, any>, obs: string): LedgerEntry | null {
    const wasEmpty = obs.includes('No news found') || obs.includes('returned no results') ||
                     obs.includes('Tool execution failed') || obs.includes('no data');

    if (toolName === 'fetch_price') {
      const pm = obs.match(/Price:\s*([\d,.]+)/);
      const cm = obs.match(/Change:\s*([-\d.]+)%/);
      const nm = obs.match(/Name:\s*([^|]+)/);
      if (pm) {
        return {
          step: 0, tool: toolName,
          fact: `${nm?.[1]?.trim() ?? args.symbol_or_name}: price ${pm[1]}${cm ? ', change ' + cm[1] + '%' : ''}`,
          quality: 'confirmed',
        };
      }
    }

    if (toolName === 'fetch_news') {
      const lines = obs.split('\n').filter(l => l.trim().startsWith('-'));
      if (lines.length > 0) {
        return {
          step: 0, tool: toolName,
          fact: `News for "${args.query}": ${lines.length} headlines found. Top: ${lines[0].replace(/^-\s*/, '').slice(0, 80)}`,
          quality: 'confirmed',
        };
      }
      return { step: 0, tool: toolName, fact: `News for "${args.query}": no relevant headlines`, quality: 'empty' };
    }

    if (toolName === 'fetch_sentiment') {
      try {
        const json = JSON.parse(obs);
        const fg   = json.fear_greed?.value;
        const fgl  = json.fear_greed?.label;
        const st   = json.reddit_buzz?.stocktwits;
        const sig  = (json.overall_signals ?? []).join(', ');
        const stStr = st ? `, StockTwits ${st.bull_ratio?.toFixed(0)}% bullish` : '';
        return {
          step: 0, tool: toolName,
          fact: `Sentiment: Fear & Greed ${fg} (${fgl})${stStr}, signals: [${sig}]`,
          quality: 'confirmed',
        };
      } catch { /* fall through */ }
    }

    if (toolName === 'web_search') {
      const lines = obs.split('\n').filter(l => l.trim().startsWith('-'));
      if (lines.length > 0) {
        // Prefer RAG-extracted source text (deepSearch) over headlines: that is
        // where the actual figures live, and the ledger must carry them so the
        // review/branch passes can genuinely verify against them rather than
        // self-attesting. The deepSearch output is a series of "## <title>\n
        // Source: <url>\n<content>" sections, one per fetched page. Collect the
        // content across ALL of them (not just the first) — each holds figures.
        const sections = obs.split(/^##\s+/m).slice(1);
        const ragText = sections
          .map(s => {
            const nl = s.indexOf('\n');
            const header = nl === -1 ? s.trim() : s.slice(0, nl).trim();
            const body = nl === -1 ? '' : s.slice(nl).replace(/^[\s\S]*?Source: [^\n]*\n?/, '').replace(/\s+/g, ' ').trim();
            return body ? `[${header.slice(0, 40)}] ${body}` : '';
          })
          .filter(Boolean)
          .join(' | ')
          .slice(0, 900);
        const factBody = ragText || lines[0].replace(/^-\s*/, '').slice(0, 80);
        return {
          step: 0, tool: toolName,
          fact: `Web search "${args.query}": ${lines.length} results. ${factBody}`,
          quality: 'confirmed',
        };
      }
      return { step: 0, tool: toolName, fact: `Web search "${args.query}": no results`, quality: 'empty' };
    }

    if (toolName === 'scan_indonesia_momentum') {
      const buyMatch     = obs.match(/BUY:\s*(\d+)/);
      const watchMatch   = obs.match(/WATCH:\s*(\d+)/);
      const scannedMatch = obs.match(/scanned:\s*(\d+)/);
      const breadthMatch = obs.match(/breadth signal:\s*([^\n]+)/);
      const topBuyMatch  = obs.match(/\[SCORE\s+(\d+)\]\s+([A-Z]+)\s+•\s+([^[\n]+)/);
      const topBuyName   = topBuyMatch ? `${topBuyMatch[2]} (${topBuyMatch[3].trim()})` : null;
      const scanned      = scannedMatch?.[1] ?? '?';
      const buyCount     = buyMatch?.[1]     ?? '0';
      const watchCount   = watchMatch?.[1]   ?? '0';
      const breadth      = breadthMatch?.[1]?.trim() ?? '';
      const topStr       = topBuyName ? `. Top pick: ${topBuyName}` : '';
      return {
        step: 0, tool: toolName,
        fact: `IDX scan (${args.sector ?? 'all'}): ${scanned} scanned, ${buyCount} BUY / ${watchCount} WATCH. ${breadth}${topStr}`,
        quality: Number(buyCount) > 0 ? 'confirmed' : 'partial',
      };
    }

    if (toolName === 'summon_agent') {
      const reportLines = obs.split('\n').filter(l => l.trim()).slice(0, 5);
      return {
        step: 0, tool: toolName,
        fact: `${args.agent_name} report received (${obs.length} chars)`,
        quality: obs.includes('Failed') || obs.includes('no usable') ? 'empty' : 'confirmed',
      };
    }

    return wasEmpty
      ? { step: 0, tool: toolName, fact: `${toolName} returned no data`, quality: 'empty' }
      : null;
  }

  // ─── Reasoning agent messages ─────────────────────────────────────────────

  // Streams one full reasoning pass: yields thought chunks while the model is
  // in its thinking block, then answer tokens. Reuses the shared thinking
  // buffer so each pass is isolated from the last.
  private async *streamThinkingPass(
    messages: LLMMessage[],
    reasoningEffort?: ReasoningEffort,
    thoughtDirective?: string,
  ): AsyncGenerator<ChatEvent> {
    // Inject the effort-scaled CoT directive so every pass (including the
    // self-review refinements) reasons at the selected depth, not just the
    // first one.
    const withDirective: LLMMessage[] = thoughtDirective
      ? messages.map(m =>
          m.role === 'system'
            ? { ...m, content: m.content + thoughtDirective }
            : m,
        )
      : messages;
    this.thinkingBuffer = '';
    this.insideThinking = false;
    for await (const chunk of this.llm.callTextStream({
      messages: withDirective,
      temperature: 0.5,
      maxTokens: 8192,
      reasoningEffort,
    })) {
      const { token: cleaned, thought: streamThought } = this.stripThinkingFromChunk(chunk);
      if (streamThought) {
        yield { type: 'thought', data: streamThought };
      }
      if (cleaned) {
        yield { type: 'token', data: cleaned };
      }
    }
  }

  // Builds an effort-scaled "look again" pass. Feeds the model its own previous
  // draft and gives it a SPECIFIC JOB rather than re-running the same generic
  // critique loop each time. The role is selected by (effort, pass):
  //   Medium (1 pass)      — NUMBER AUDIT: tag every hard number tool-verified or
  //                          illustrative; never invent a replacement.
  //   High   (1 pass)      — LOGIC/COMPLETENESS: check the argument holds against
  //                          the ledger and nothing important is missing.
  //   Extra  (2 passes)    — pass 1 = number audit, pass 2 = BREADTH (widen to
  //                          channels/sources the draft left out).
  // The review produces a corrected answer, but the correction is to how figures
  // are framed (verified vs illustrative) and how complete the reasoning is —
  // not a re-roll of the same unverified specifics.
  private buildSelfReviewMessages(
    messages: LLMMessage[],
    ledger: LedgerEntry[],
    draft: string,
    effort: ThoughtEffort,
    pass: number,
  ): { messages: LLMMessage[]; thought: string } {
    // Conversation context — drop tool messages for token efficiency.
    const conversationContext = messages.filter(
      m => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && !m.tool_calls),
    ).slice(-8);

    // Render the ledger with disagreement surfacing: rival values for the same
    // quantity keep both numbers AND get an explicit "disagrees with the above"
    // marker, so the audit/logic/breadth pass can genuinely cross-check instead
    // of rubber-stamping a single flattened value.
    const confirmedFacts = formatLedgerFacts(ledger);

    // Which job this pass performs.
    const role: 'audit' | 'logic' | 'breadth' =
      effort === 'High' ? 'logic'
      : effort === 'Extra' ? (pass === 1 ? 'audit' : 'breadth')
      : 'audit';

    let systemPrompt: string;
    let taskLine: string;
    let thought: string;

    if (role === 'breadth') {
      systemPrompt = [
        'You are the BREADTH REVIEW engine inside BOZ, a quantitative market analyst AI.',
        'A draft answer has already been produced and its numbers audited. Your job is to widen its coverage.',
        '',
        'REVIEW FRAMEWORK (execute it, do not re-explain it):',
        '  1. GAP-HUNT: what important angle, channel, or source did the draft leave out?',
        '     (e.g. rates, FX, commodities, USD-debt exposure, passive/institutional flows, retail share, fiscal-monetary interaction, sector-level dispersion)',
        '  2. BREADTH: add the missing channels at a level the confirmed facts support.',
        '  3. DISCIPLINE: for any new number you introduce, either cite the confirmed ledger or mark it ILLUSTRATIVE (a range, not a point value). You CANNOT call tools, so unverified figures get the ILLUSTRATIVE label here, not a dangling "needs verification".',
        '  4. RELEASE: produce the final, widened answer. No hedging theatre.',
        '',
        'OUTPUT:',
        '  - A broader version of the draft that covers the missing channels.',
        '  - Keep the same structure and tone.',
        '  - Do NOT restate the framework, the review-pass label, or the original task. Just give the refined answer.',
      ].join('\n');
      taskLine = `Widen the draft to cover the channels it left out, at the level the confirmed facts support.`;
      thought = `Before answering, let me widen the net — which channels or sources did the draft leave out?`;
    } else if (role === 'logic') {
      systemPrompt = [
        'You are the LOGIC REVIEW engine inside BOZ, a quantitative market analyst AI.',
        'A draft answer has already been produced. Your job is to stress-test its reasoning and completeness — and to APPLY the framework, not narrate it.',
        '',
        'REVIEW FRAMEWORK (execute it, do not re-explain it):',
        '  1. ATTACK: where is the draft wrong, overstated, or missing context?',
        '  2. CHECK: does every claim hold against the confirmed facts? Flag any unsupported leap.',
        '  3. GAP-HUNT: what important angle or risk was left out?',
        '  4. CORRECT: fix errors and tighten the reasoning.',
        '  5. RELEASE: produce the final, corrected answer. No hedging theatre.',
        '',
        'NUMBER DISCIPLINE — HARD:',
        '  - You CANNOT call tools in this pass. So every figure must reach a verdict NOW:',
        '      (a) TOOL-VERIFIED → keep as fact.',
        '      (b) not in the ledger → mark ILLUSTRATIVE (a range, not a point value).',
        '      (c) neither, and it carries the argument → DROP it.',
        '  - NEVER leave a number "needs verification". That phrase is not an outcome —',
        '    unverified figures are labelled or removed in this pass, full stop.',
        '  - Do NOT invent replacement numbers.',
        '',
        'OUTPUT:',
        '  - A cleaner, more rigorous version of the draft answer.',
        '  - Keep the same structure and tone, but sharper and fully evidence-grounded.',
        '  - Do NOT restate the framework, the review-pass label, or the original task. Just give the refined answer.',
      ].join('\n');
      taskLine = `Stress-test the draft against the confirmed facts and tighten it. Apply the framework directly — do not restate it or the task.`;
      thought = `Before answering, let me check the reasoning: does every claim hold against the confirmed facts, and is any important angle missing?`;
    } else {
      systemPrompt = [
        'You are the NUMBER AUDITOR inside BOZ, a quantitative market analyst AI.',
        'A draft answer has already been produced. Your job is to audit its hard numbers.',
        '',
        'REVIEW FRAMEWORK (execute it, do not re-explain it):',
        '  1. FLAG: identify every specific number in the draft (rates, prices, spreads, percentages, ratios).',
        '  2. CLASSIFY: for each, is it TOOL-VERIFIED (traces to a confirmed fact in this conversation) or ILLUSTRATIVE (the author\'s estimate)?',
        '  3. STRENGTHEN: for each ILLUSTRATIVE figure, either (a) replace it with the confirmed figure if one exists, (b) soften it to an explicit "illustrative range", or (c) drop it if it carries the argument.',
        '  4. DO NOT: invent a replacement number, or state any figure as fact that is not in the confirmed ledger.',
        '  5. RELEASE: produce the corrected final answer.',
        '',
        'NUMBER DISCIPLINE — HARD:',
        '  - You CANNOT call tools in this pass. Every figure reaches a verdict NOW:',
        '      (a) TOOL-VERIFIED → keep as fact.',
        '      (b) not in the ledger → ILLUSTRATIVE (a range, not a point value).',
        '      (c) neither, and it carries the argument → DROP it.',
        '  - NEVER leave a number "needs verification". That phrase is not an outcome —',
        '    unverified figures are labelled or removed in this pass, full stop.',
        '',
        'OUTPUT:',
        '  - The refined answer with every number honestly labelled verified or illustrative.',
        '  - Keep the same structure and tone.',
        '  - Do NOT restate the framework, the review-pass label, or the original task. Just give the refined answer.',
      ].join('\n');
      taskLine = `Audit every figure in the draft: tag it TOOL-VERIFIED or ILLUSTRATIVE, soften or drop what is unverified — never invent a replacement number.`;
      thought = `Let me audit the draft before answering — every number must be tool-verified or clearly illustrative, never left dangling.`;
    }

    const userPrompt = [
      confirmedFacts ? `CONFIRMED FACTS (immutable — do not contradict):\n${confirmedFacts}\n` : '',
      draft ? `PREVIOUS DRAFT TO REVIEW:\n${draft}\n` : '',
      taskLine,
    ].filter(Boolean).join('\n');

    return {
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationContext,
        { role: 'user', content: userPrompt },
      ],
      thought,
    };
  }

  // Builds an independent scenario branch for Max effort. Each branch reasons
  // from the same ledger but along a different path (bull / base / bear), then a
  // synthesis pass merges the branches into the final answer.
  private buildScenarioMessages(
    messages: LLMMessage[],
    ledger: LedgerEntry[],
    draft: string,
    scenario: string,
  ): LLMMessage[] {
    const conversationContext = messages.filter(
      m => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && !m.tool_calls),
    ).slice(-8);

    // Same disagreement-surfacing rendering as the review passes, so each branch
    // and the synthesis pass can weigh rival figures rather than one flattened value.
    const confirmedFacts = formatLedgerFacts(ledger);

    const isSynthesis = scenario.includes('synthesis');

    const systemPrompt = [
      isSynthesis
        ? 'You are the SYNTHESIS engine inside BOZ, a quantitative market analyst AI.'
        : 'You are a SCENARIO ANALYST inside BOZ, a quantitative market analyst AI.',
      isSynthesis
        ? 'Independent scenario branches (bullish, base, bearish) have been produced. Your job is to merge them into one coherent final answer.'
        : 'You reason along ONE independent path. Other analysts are running the other paths in parallel.',
      '',
      'FRAMEWORK:',
      isSynthesis
        ? [
            '  1. MERGE: pull the strongest, evidence-grounded reasoning from each branch.',
            '  2. WEIGHT: give each scenario the weight the confirmed facts support — do not average them into mush.',
            '  3. SENSITIVITY: state what would tip the balance from one scenario to another, qualitatively where the figures are ungrounded.',
            '  4. RELEASE: produce the final answer with the scenario that the evidence best supports, and the risk stated in one line.',
          ].join('\n')
        : [
            '  1. BRANCH: run the argument fully along this path (e.g. Fed cuts twice vs holds vs hikes).',
            '  2. DRIVERS: which confirmed facts would have to be true for this path to play out?',
            '  3. SENSITIVITY: where this path depends on an ungrounded number, state it qualitatively.',
            '  4. RELEASE: produce the branch analysis. Do not hedge into the other branches — commit to this path.',
          ].join('\n'),
      '',
      'NUMBER DISCIPLINE:',
      '  - A number stated as fact must trace to the confirmed ledger.',
      '  - Anything else is an ILLUSTRATIVE range, stated qualitatively where ungrounded.',
      '',
      'OUTPUT:',
      isSynthesis
        ? '  - The final, synthesized answer. Keep the same structure and tone as the draft.'
        : '  - The branch analysis. Keep the same structure and tone as the draft.',
      '  - Do NOT meta-comment about the review process. Just give the analysis.',
    ].join('\n');

    const userPrompt = [
      confirmedFacts ? `CONFIRMED FACTS (immutable — do not contradict):\n${confirmedFacts}\n` : '',
      draft
        ? (isSynthesis
            ? `SCENARIO BRANCH OUTPUTS TO SYNTHESIZE:\n${draft}\n`
            : `PREVIOUS DRAFT TO BUILD ON:\n${draft}\n`)
        : '',
      isSynthesis
        ? `Synthesize the scenario branches into one final answer, weighted by the evidence.`
        : `This is an independent scenario branch: ${scenario}. Produce the analysis for this path.`,
    ].filter(Boolean).join('\n');

    return [
      { role: 'system', content: systemPrompt },
      ...conversationContext,
      { role: 'user', content: userPrompt },
    ];
  }

  private buildReasoningMessages(messages: LLMMessage[], ledger: LedgerEntry[]): LLMMessage[] {
    const confirmedFacts = formatLedgerFacts(ledger);

    const reasoningSystemPrompt = [
      'You are the ANALYSIS ENGINE inside BOZ, a quantitative market analyst AI.',
      'You receive a locked evidence ledger from the data-gathering phase, along with conversation history.',
      'Your job: produce the final market analysis and action plan.',
      '',
      'HARD CONSTRAINTS:',
      '  1. You MUST use every confirmed fact. Do not ignore any.',
      '  2. You CANNOT contradict confirmed facts.',
      '  3. For empty results: acknowledge honestly. Do not invent data.',
      '  4. Apply contrarian analysis:',
      '     StockTwits >70% bullish = crowd euphoria = caution',
      '     Fear & Greed >75 = reduce long confidence',
      '     Fear & Greed <25 = strong buy signal',
      '  5. Incorporate fundamental reality and warn about speculative micro-caps.',
      '',
      'OUTPUT FORMAT:',
      '  - Natural, conversational style with rich markdown formatting.',
      '  - Use **bold**, headers, bullet lists, and tables when helpful.',
      '  - Focus on actionable insights and clear takeaways.',
      '  - Maintain a global perspective unless explicitly asked otherwise.',
      '  - End with a clear Action Plan: Buy / Hold / Wait, with entry, stop-loss, target if applicable.',
    ].join('\n');

    const reasoningUserPrompt = [
      'CONFIRMED DATA (immutable — you must use and cannot contradict):',
      confirmedFacts || '  (none)',
      '',
      'Produce a complete, accurate market analysis and action plan based strictly on the above data and the conversation history.',
    ].filter(Boolean).join('\n');

    // Include conversation context but prune tool messages for token efficiency
    const conversationContext = messages.filter(
      m => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && !m.tool_calls),
    ).slice(-8);

    return [
      { role: 'system', content: reasoningSystemPrompt },
      ...conversationContext,
      { role: 'user',   content: reasoningUserPrompt },
    ];
  }

  // ─── Model fallback ───────────────────────────────────────────────────────

  private async callWithFallback(
    messages:    LLMMessage[],
    tools:       object[],
    temperature: number,
    options: { reasoningEffort?: ReasoningEffort; assistantPrefill?: string } = {},
  ): Promise<LLMMessage> {
    try {
      return await this.llm.callWithTools({
        messages,
        tools,
        temperature,
        maxTokens: 4096,
        reasoningEffort: options.reasoningEffort,
        assistantPrefill: options.assistantPrefill,
      });
    } catch (err: any) {
      const status = err?.response?.status || err?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600) ||
                          err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT';

      if (isRetryable) {
        const fallbackModel = this.getFallbackModel();
        if (fallbackModel) {
          await new Promise(r => setTimeout(r, 3000));
          return await this.llm.callWithTools({
            messages,
            tools,
            temperature,
            maxTokens: 4096,
            model: fallbackModel,
            reasoningEffort: options.reasoningEffort,
            assistantPrefill: options.assistantPrefill,
          });
        }
      }
      throw err;
    }
  }

  private getFallbackModel(): string | null {
    const provider = config.aiProvider;
    if (provider === 'github') {
      const current = config.github.model;
      const idx = GITHUB_MODELS.findIndex(m => m.id === current);
      // Try gpt-4o-mini as fallback, or next in list
      if (current !== 'openai/gpt-4o-mini') return 'openai/gpt-4o-mini';
      if (idx >= 0 && idx < GITHUB_MODELS.length - 1) return GITHUB_MODELS[idx + 1].id;
    }
    if (provider === 'nvidia') {
      const current = config.nvidia.model;
      const idx = NVIDIA_MODELS.findIndex(m => m.id === current);
      if (idx >= 0 && idx < NVIDIA_MODELS.length - 1) return NVIDIA_MODELS[idx + 1].id;
    }
    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private parseToolCall(rawCall: RawToolCall): ParsedToolCall {
    let args: Record<string, any> = {};
    try {
      args = JSON.parse(rawCall.function?.arguments ?? '{}');
    } catch {
      args = {};
    }
    return { name: rawCall.function?.name ?? '', arguments: args };
  }

  private async retrySimple<T>(fn: () => Promise<T>, maxRetries = 3, delay = 2000): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) throw err;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  private stripThinkingFull(text: string): string {
    if (!text) return '';
    return text
      .replace(/<think>\s*\n?\s*Thinking Process:\s*\n?\s*1\.\s*/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>\n*/gi, '')
      .replace(/<think>[\s\S]*?<\/think>\n*/gi, '')
      .trim();
  }

  // For streaming: tracks if we're inside a thinking block and filters it
  private thinkingBuffer = '';
  private insideThinking = false;

  private stripThinkingFromChunk(chunk: string): { token: string, thought: string } {
    this.thinkingBuffer += chunk;
    let token = '';
    let thought = '';

    while (this.thinkingBuffer.length > 0) {
      if (this.insideThinking) {
        const endIdx = this.thinkingBuffer.indexOf('</thinking>');
        const endIdx2 = this.thinkingBuffer.indexOf('</think>');
        const endTag = endIdx !== -1 ? '</thinking>' : endIdx2 !== -1 ? '</think>' : null;
        const endPos = endIdx !== -1 ? endIdx : endIdx2 !== -1 ? endIdx2 : -1;

        if (endTag && endPos !== -1) {
          // Found end of thinking block — capture thought and skip tag
          thought += this.thinkingBuffer.slice(0, endPos);
          this.thinkingBuffer = this.thinkingBuffer.slice(endPos + endTag.length).replace(/^\n+/, '');
          this.insideThinking = false;
        } else {
          // Still inside thinking block — check for partial end tags
          const partialCheck = this.thinkingBuffer.slice(-12);
          const mightBePartial = '</thinking>'.startsWith(partialCheck.slice(partialCheck.lastIndexOf('<'))) ||
                                  '</think>'.startsWith(partialCheck.slice(partialCheck.lastIndexOf('<')));
          if (mightBePartial && partialCheck.includes('<')) {
            const lastLt = this.thinkingBuffer.lastIndexOf('<');
            thought += this.thinkingBuffer.slice(0, lastLt);
            this.thinkingBuffer = this.thinkingBuffer.slice(lastLt);
          } else {
            thought += this.thinkingBuffer;
            this.thinkingBuffer = '';
          }
          break;
        }
      } else {
        const startIdx = this.thinkingBuffer.indexOf('<thinking>');
        const startIdx2 = this.thinkingBuffer.indexOf('<think>');
        const startTag = startIdx !== -1 ? '<thinking>' : startIdx2 !== -1 ? '<think>' : null;
        const startPos = startIdx !== -1 ? startIdx : startIdx2 !== -1 ? startIdx2 : -1;

        if (startTag && startPos !== -1) {
          // Output everything before the thinking tag
          token += this.thinkingBuffer.slice(0, startPos);
          this.thinkingBuffer = this.thinkingBuffer.slice(startPos + startTag.length);
          this.insideThinking = true;
        } else {
          // Check if buffer might contain a partial tag at the end
          const partialCheck = this.thinkingBuffer.slice(-12); // Max tag length is 10 (<thinking>)
          const mightBePartial = '<thinking>'.startsWith(partialCheck.slice(partialCheck.lastIndexOf('<'))) ||
                                  '<think>'.startsWith(partialCheck.slice(partialCheck.lastIndexOf('<')));

          if (mightBePartial && partialCheck.includes('<')) {
            const lastLt = this.thinkingBuffer.lastIndexOf('<');
            token += this.thinkingBuffer.slice(0, lastLt);
            this.thinkingBuffer = this.thinkingBuffer.slice(lastLt);
          } else {
            token += this.thinkingBuffer;
            this.thinkingBuffer = '';
          }
          break;
        }
      }
    }

    return { token, thought };
  }
}
