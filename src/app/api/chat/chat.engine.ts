// ─── chat.engine.ts ───────────────────────────────────────────────────────────
// Server-side chat engine for BOZ web app.
// Brings CLI-level intelligence to the browser: tool calling, evidence ledger,
// sub-agent delegation, two-pass reasoning, model fallback, and SSE streaming.

import { LLMAdapter } from '@/services/ai/llm.adapter';
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatEvent {
  type: 'tool_start' | 'tool_result' | 'reasoning_start' | 'token' | 'done' | 'error';
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

// ─── WebChatEngine ────────────────────────────────────────────────────────────

export class WebChatEngine {
  private llm = new LLMAdapter();
  private sentimentService = new SentimentService();

  // ─── Main entry point ─────────────────────────────────────────────────────
  // Yields streaming ChatEvent objects for the SSE route to emit.

  async *run(params: {
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): AsyncGenerator<ChatEvent> {
    const { message, history } = params;

    // ── Build message list ──────────────────────────────────────────────────
    const messages: LLMMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
    ];

    if (history?.length) {
      for (const msg of history.slice(-MAX_HISTORY_MESSAGES)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    // ── First AI call — with tools ──────────────────────────────────────────
    let aiMessage: LLMMessage;
    try {
      aiMessage = await this.callWithFallback(messages, this.getToolDefinitions(), 0.3);
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
            obs = await this.executeTool(call.name, call.arguments, messages, ledger);
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

      // Next AI call — decide if more tools or final answer
      try {
        aiMessage = await this.callWithFallback(messages, this.getToolDefinitions(), 0.3);
      } catch (err) {
        yield { type: 'error', data: { message: err instanceof Error ? err.message : 'AI follow-up call failed' } };
        return;
      }
    }

    // ── Final response ──────────────────────────────────────────────────────
    if (ledger.length > 0) {
      // Two-pass: run reasoning agent with evidence ledger
      const confirmedCount = ledger.filter(e => e.quality === 'confirmed').length;
      yield { type: 'reasoning_start', data: { confirmedFacts: confirmedCount, totalSteps: step } };

      try {
        const reasoningMessages = this.buildReasoningMessages(messages, ledger);
        for await (const chunk of this.llm.callTextStream({
          messages:    reasoningMessages,
          temperature: 0.5,
          maxTokens:   4096,
        })) {
          // Strip thinking tags from streamed output
          const cleaned = this.stripThinkingFromChunk(chunk);
          if (cleaned) {
            yield { type: 'token', data: cleaned };
          }
        }
      } catch (err) {
        yield { type: 'error', data: { message: 'Reasoning agent failed: ' + (err instanceof Error ? err.message : String(err)) } };
        return;
      }
    } else if (aiMessage.content) {
      // Simple response — no tools were called. Stream directly.
      // The content is already complete from callWithTools, so emit as one chunk.
      const cleaned = this.stripThinkingFull(aiMessage.content);
      yield { type: 'token', data: cleaned };
    } else {
      yield { type: 'token', data: 'I couldn\'t generate a response. Please try again.' };
    }

    yield { type: 'done', data: { totalSteps: step } };
  }

  // ─── System prompt (ported from CLI, adapted for web) ─────────────────────

  private buildSystemPrompt(): string {
    const memory = memoryService.getMemory();
    const prefs = memory.preferences.length
      ? `\nUSER PREFERENCES:\n${memory.preferences.map(p => '  - ' + p).join('\n')}`
      : '';
    const facts = memory.facts.length
      ? `\nUSER FACTS:\n${memory.facts.map(f => '  - ' + f).join('\n')}`
      : '';

    return [
      'You are BOZ (Behavioral Outlook Zone), an elite AI market assistant and quantitative analyst.',
      'You think like a hedge fund analyst — skeptical, data-driven, always asking "is this enough?"',
      prefs,
      facts,
      '',
      'CONVERSATIONAL AI RULES:',
      '  - You have FULL AUTONOMY to decide whether tools are needed.',
      '  - If the user is greeting you, asking a generic question, or asking a follow-up that',
      '    can be answered from conversation history, DO NOT call tools. Just answer naturally.',
      '  - If you genuinely need live data, news, or a fresh scan, then call the tools.',
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
  ): Promise<string> {
    switch (name) {

      case 'summon_agent': {
        const agentName = (args.agent_name as string) ?? 'UnknownAgent';
        const task = (args.task as string) ?? '';
        return await this.simulateSubAgent(agentName, task, messages, ledger);
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
        return await webSearchService.search(query);
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
        return {
          step: 0, tool: toolName,
          fact: `Web search "${args.query}": ${lines.length} results. Top: ${lines[0].replace(/^-\s*/, '').slice(0, 80)}`,
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

  private buildReasoningMessages(messages: LLMMessage[], ledger: LedgerEntry[]): LLMMessage[] {
    const confirmedFacts = ledger.filter(e => e.quality === 'confirmed').map(e => `  • ${e.fact}`).join('\n');
    const emptyFacts     = ledger.filter(e => e.quality === 'empty').map(e => `  • ${e.fact}`).join('\n');

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
      emptyFacts ? ('GAPS IN DATA (be honest about these):\n' + emptyFacts) : '',
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
  ): Promise<LLMMessage> {
    try {
      return await this.llm.callWithTools({ messages, tools, temperature, maxTokens: 4096 });
    } catch (err: any) {
      const status = err?.response?.status || err?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600) ||
                          err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT';

      if (isRetryable) {
        const fallbackModel = this.getFallbackModel();
        if (fallbackModel) {
          await new Promise(r => setTimeout(r, 3000));
          return await this.llm.callWithTools({
            messages, tools, temperature, maxTokens: 4096, model: fallbackModel,
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
      .replace(/<thinking>[\s\S]*?<\/thinking>\n*/gi, '')
      .replace(/<think>[\s\S]*?<\/think>\n*/gi, '')
      .trim();
  }

  // For streaming: tracks if we're inside a thinking block and filters it
  private thinkingBuffer = '';
  private insideThinking = false;

  private stripThinkingFromChunk(chunk: string): string {
    this.thinkingBuffer += chunk;
    let output = '';

    while (this.thinkingBuffer.length > 0) {
      if (this.insideThinking) {
        const endIdx = this.thinkingBuffer.indexOf('</thinking>');
        const endIdx2 = this.thinkingBuffer.indexOf('</think>');
        const endTag = endIdx !== -1 ? '</thinking>' : endIdx2 !== -1 ? '</think>' : null;
        const endPos = endIdx !== -1 ? endIdx : endIdx2 !== -1 ? endIdx2 : -1;

        if (endTag && endPos !== -1) {
          // Found end of thinking block — skip everything up to and including the tag
          this.thinkingBuffer = this.thinkingBuffer.slice(endPos + endTag.length).replace(/^\n+/, '');
          this.insideThinking = false;
        } else {
          // Still inside thinking block — consume entire buffer
          this.thinkingBuffer = '';
          break;
        }
      } else {
        const startIdx = this.thinkingBuffer.indexOf('<thinking>');
        const startIdx2 = this.thinkingBuffer.indexOf('<think>');
        const startTag = startIdx !== -1 ? '<thinking>' : startIdx2 !== -1 ? '<think>' : null;
        const startPos = startIdx !== -1 ? startIdx : startIdx2 !== -1 ? startIdx2 : -1;

        if (startTag && startPos !== -1) {
          // Output everything before the thinking tag
          output += this.thinkingBuffer.slice(0, startPos);
          this.thinkingBuffer = this.thinkingBuffer.slice(startPos + startTag.length);
          this.insideThinking = true;
        } else {
          // Check if buffer might contain a partial tag at the end
          const partialCheck = this.thinkingBuffer.slice(-12); // Max tag length is 10 (<thinking>)
          const mightBePartial = '<thinking>'.startsWith(partialCheck.slice(partialCheck.lastIndexOf('<'))) ||
                                  '<think>'.startsWith(partialCheck.slice(partialCheck.lastIndexOf('<')));

          if (mightBePartial && partialCheck.includes('<')) {
            const lastLt = this.thinkingBuffer.lastIndexOf('<');
            output += this.thinkingBuffer.slice(0, lastLt);
            this.thinkingBuffer = this.thinkingBuffer.slice(lastLt);
          } else {
            output += this.thinkingBuffer;
            this.thinkingBuffer = '';
          }
          break;
        }
      }
    }

    return output;
  }
}
