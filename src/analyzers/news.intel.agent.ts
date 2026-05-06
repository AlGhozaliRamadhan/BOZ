import OpenAI from 'openai';
import axios from 'axios';
import { log, clr } from '../utils/logger.js';
import { config } from '../config/config.js';
import { NewsIntelAnalyzer } from './news.intel.analyzer.js';
import { yahooFinance } from '../services/yahoo.service.js';

// ─── Agent Types ──────────────────────────────────────────────────────────────

type ToolName =
  | 'fetch_news'
  | 'fetch_price'
  | 'fetch_fear_greed'
  | 'fetch_trending_crypto'
  | 'search_news_by_asset'
  | 'summarize_findings'
  | 'emit_opportunities'
  | 'request_deeper_analysis'
  | 'finish';

interface ToolCall {
  id:        string;
  name:      ToolName;
  arguments: Record<string, any>;
}

interface ToolResult {
  tool_call_id: string;
  name:         ToolName;
  content:      string;
}

interface AgentMessage {
  role:        'system' | 'user' | 'assistant' | 'tool';
  content:     string | null;
  tool_calls?: RawToolCall[];
  tool_call_id?: string;
  name?:       string;
}

interface RawToolCall {
  id:       string;
  type:     'function';
  function: { name: string; arguments: string };
}

interface AgentOpportunity {
  asset:        string;
  asset_type:   string;
  action:       'BUY' | 'SELL' | 'WATCH';
  confidence:   number;
  reasoning:    string;
  entry_range:  string;
  target_range: string;
  stop_loss:    string;
  invalidation: string;
  risks:        string;
  spot_price?:  number;
  late_signal:  string;
}

interface AgentState {
  iteration:          number;
  thoughts:           string[];
  toolsUsed:          string[];
  fetchedAssets:      Set<string>;
  collectedNews:      string[];
  opportunities:      AgentOpportunity[];
  marketRegime:       string;
  marketSummary:      string;
  riskWarnings:       string[];
  contrarian:         string[];
  recommendedActions: string[];
  finished:           boolean;
  startTime:          number;
}

// ─── Tool Definitions (OpenAI function-calling schema) ────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'fetch_news',
      description: 'Fetch a broad sweep of market news across all asset classes: crypto, stocks, economy, commodities, oil, forex. Returns top headlines with impact ratings. Call this first to understand what is happening in markets.',
      parameters: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            enum: ['all', 'crypto', 'stocks', 'macro', 'commodities'],
            description: 'Which market segment to prioritise in the summary.',
          },
        },
        required: ['focus'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_price',
      description: 'Fetch the current live market price for any asset. Accepts common name variants (BTC, BITCOIN, GOLD, SPY, NVDA, EURUSD, etc.).',
      parameters: {
        type: 'object',
        properties: {
          asset: { type: 'string', description: 'Asset name or ticker symbol.' },
        },
        required: ['asset'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_fear_greed',
      description: 'Fetch the current Crypto Fear & Greed index (0-100) with 7-day trend and momentum. Use this to calibrate crowd sentiment and identify contrarian setups.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_trending_crypto',
      description: 'Fetch the top trending cryptocurrencies on CoinGecko right now, with 24h price changes and community sentiment from the top 10 by market cap.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_news_by_asset',
      description: 'Search and filter the fetched news for a specific asset or topic. Use this to deep-dive into a single asset after fetch_news has run.',
      parameters: {
        type: 'object',
        properties: {
          asset:  { type: 'string',  description: 'Asset name, ticker, or topic keyword.' },
          limit:  { type: 'number',  description: 'Max headlines to return (default 10).' },
        },
        required: ['asset'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'summarize_findings',
      description: 'Record your current working analysis: market regime, key themes, and any contrarian signals you have identified. Call this after each major reasoning step to checkpoint your thinking. This does NOT end the session.',
      parameters: {
        type: 'object',
        properties: {
          market_regime:   { type: 'string', enum: ['RISK_ON', 'RISK_OFF', 'TRANSITION'], description: 'Current market regime.' },
          market_summary:  { type: 'string', description: '2-3 sentence synthesis of dominant cross-asset theme.' },
          key_themes:      { type: 'array', items: { type: 'string' }, description: 'Cross-asset propagation chains discovered so far.' },
          contrarian:      { type: 'array', items: { type: 'string' }, description: 'Crowd signals that suggest the opposite of consensus.' },
          risk_warnings:   { type: 'array', items: { type: 'string' }, description: 'Active risk factors that should constrain position sizing.' },
        },
        required: ['market_regime', 'market_summary'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'emit_opportunities',
      description: 'Record one or more specific trade or watch opportunities you have identified with full trade parameters. Call this when you have enough data to justify a specific setup. Multiple calls accumulate.',
      parameters: {
        type: 'object',
        properties: {
          opportunities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                asset:        { type: 'string' },
                asset_type:   { type: 'string', enum: ['crypto', 'stock', 'commodity', 'forex', 'index'] },
                action:       { type: 'string', enum: ['BUY', 'SELL', 'WATCH'] },
                confidence:   { type: 'number', description: '0-100. >80 requires 3 independent confirming signals.' },
                reasoning:    { type: 'string', description: 'Bull vs bear case. Be specific — cite the data.' },
                entry_range:  { type: 'string', description: 'e.g. "from 64200 to 65800"' },
                target_range: { type: 'string', description: 'e.g. "from 69000 to 74000"' },
                stop_loss:    { type: 'string', description: 'Specific price level.' },
                invalidation: { type: 'string', description: 'The specific condition that would flip this thesis.' },
                risks:        { type: 'string', description: 'Comma-separated list of 2-3 risks.' },
                late_signal:  { type: 'string', enum: ['YES', 'NO'], description: 'Is this move already extended?' },
              },
              required: ['asset', 'asset_type', 'action', 'confidence', 'reasoning', 'entry_range', 'target_range', 'stop_loss', 'invalidation', 'risks', 'late_signal'],
            },
          },
        },
        required: ['opportunities'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_deeper_analysis',
      description: 'Signal that you want to investigate further before concluding. Use this when you have spotted something that needs more data — e.g. a divergence between assets, an unusual crowd reading, or a conflicting signal. State exactly what you want to investigate next.',
      parameters: {
        type: 'object',
        properties: {
          reason:       { type: 'string', description: 'What specifically needs more investigation.' },
          next_actions: { type: 'array', items: { type: 'string' }, description: 'List of tool calls you plan to make next.' },
        },
        required: ['reason', 'next_actions'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish',
      description: 'End the analysis session and produce the final output. Call this ONLY when you have: (1) fetched broad market data, (2) checked fear/greed, (3) investigated at least 2-3 specific assets, (4) recorded a market summary, and (5) emitted all identified opportunities. Do not call finish prematurely.',
      parameters: {
        type: 'object',
        properties: {
          recommended_actions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Final 3-5 specific actionable recommendations with timeframes.',
          },
          final_thoughts: {
            type: 'string',
            description: 'Any final caveats, meta-observations, or things the reader should know.',
          },
        },
        required: ['recommended_actions'],
      },
    },
  },
];

// ─── Symbol map (shared with base analyzer) ───────────────────────────────────

const SYMBOL_MAP: Record<string, string> = {
  'SP500': '^GSPC', 'S&P500': '^GSPC', 'S&P 500': '^GSPC', 'SPX': '^GSPC', 'SPY': 'SPY',
  'NASDAQ': '^IXIC', 'QQQ': 'QQQ', 'DOW': '^DJI', 'DJI': '^DJI',
  'DXY': 'DX-Y.NYB', 'DOLLAR': 'DX-Y.NYB',
  'EURUSD': 'EURUSD=X', 'USDJPY': 'JPY=X', 'GBPUSD': 'GBPUSD=X',
  'AUDUSD': 'AUDUSD=X', 'USDCAD': 'CAD=X', 'USDCHF': 'CHF=X',
  'TLT': 'TLT', 'TNX': '^TNX', '10Y': '^TNX', 'US10Y': '^TNX',
  'GOLD': 'GC=F', 'XAU': 'GC=F', 'XAUUSD': 'GC=F',
  'SILVER': 'SI=F', 'XAG': 'SI=F',
  'OIL': 'CL=F', 'WTI': 'CL=F', 'USOIL': 'CL=F', 'CRUDE': 'CL=F',
  'BRENT': 'BZ=F', 'NATGAS': 'NG=F', 'COPPER': 'HG=F',
  'BTC': 'BTC-USD', 'BITCOIN': 'BTC-USD',
  'ETH': 'ETH-USD', 'ETHEREUM': 'ETH-USD',
  'SOL': 'SOL-USD', 'SOLANA': 'SOL-USD',
  'XRP': 'XRP-USD', 'RIPPLE': 'XRP-USD',
  'BNB': 'BNB-USD', 'ADA': 'ADA-USD',
  'DOGE': 'DOGE-USD', 'AVAX': 'AVAX-USD', 'DOT': 'DOT-USD',
  'MATIC': 'MATIC-USD', 'LINK': 'LINK-USD',
  'NVDA': 'NVDA', 'NVIDIA': 'NVDA',
  'AAPL': 'AAPL', 'APPLE': 'AAPL',
  'MSFT': 'MSFT', 'MICROSOFT': 'MSFT',
  'GOOGL': 'GOOGL', 'GOOGLE': 'GOOGL',
  'META': 'META', 'AMZN': 'AMZN', 'AMAZON': 'AMZN',
  'TSLA': 'TSLA', 'TESLA': 'TSLA',
  'AMD': 'AMD', 'INTC': 'INTC',
  'NFLX': 'NFLX', 'JPM': 'JPM', 'BAC': 'BAC', 'GS': 'GS',
};

const LATE_KEYWORDS = [
  'already surged', 'soared', 'spiked', 'record high', 'all-time high',
  'all time high', 'ath', 'parabolic', 'overbought', 'extended move',
  'blew past', 'blew through', 'broke out', 'exploded higher',
];

// ─── Agentic News Intel Analyzer ─────────────────────────────────────────────

export class NewsIntelAgent {
  private readonly baseAnalyzer = new NewsIntelAnalyzer();
  private readonly headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  };

  // Cached raw news data fetched on first tool call
  private newsCache: Record<string, any> | null = null;

  // ─── Entry point ────────────────────────────────────────────────────────

  // Safety limits — agent decides when done via `finish`; these are last-resort guards only
  private readonly TIME_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
  private readonly ITER_HARD_CAP = 50;

  public async runAnalysis(): Promise<void> {
    log.info('agent', 'Starting Agentic News Intel...');

    const state: AgentState = {
      iteration:          0,
      thoughts:           [],
      toolsUsed:          [],
      fetchedAssets:      new Set(),
      collectedNews:      [],
      opportunities:      [],
      marketRegime:       'TRANSITION',
      marketSummary:      '',
      riskWarnings:       [],
      contrarian:         [],
      recommendedActions: [],
      finished:           false,
      startTime:          Date.now(),
    };

    const messages: AgentMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user',   content: this.buildInitialPrompt() },
    ];

    console.log('\n' + clr.dim('━'.repeat(80)));
    console.log(clr.magenta('  [AGENT]  AGENTIC NEWS INTEL  —  FREE-RUNNING'));
    console.log(clr.dim('  Agent thinks freely and stops when it decides it\'s done.'));
    console.log(clr.dim('━'.repeat(80)) + '\n');

    // ── ReAct loop ────────────────────────────────────────────────────────────
    // Thought → Action → Observation → Thought → ...
    // The agent calls `finish` when it is satisfied. We only stop it if time or
    // the hard cap is exceeded.
    while (!state.finished) {
      const elapsed = Date.now() - state.startTime;
      if (elapsed > this.TIME_LIMIT_MS) {
        log.warn('agent', 'Time limit (10 min) reached — stopping.');
        break;
      }
      if (state.iteration >= this.ITER_HARD_CAP) {
        log.warn('agent', `Hard cap (${this.ITER_HARD_CAP} iterations) reached — stopping.`);
        break;
      }

      state.iteration++;
      const sec = ((Date.now() - state.startTime) / 1000).toFixed(0);
      console.log(clr.dim(`\n  ┄┄ [${sec}s] step ${state.iteration} — agent is thinking...`));

      let assistantMsg: AgentMessage;
      try {
        assistantMsg = await this.callAI(messages);
      } catch (err: any) {
        log.error('agent', `AI call failed: ${err.message}`);
        break;
      }

      messages.push(assistantMsg);

      // ── THOUGHT — print the agent's reasoning aloud ──────────────────────
      if (assistantMsg.content && assistantMsg.content.trim().length > 0) {
        const thought = assistantMsg.content.trim();
        state.thoughts.push(thought);
        console.log('');
        // Word-wrap at 76 chars
        const words = thought.split(/\s+/);
        let line = '';
        for (const word of words) {
          const candidate = line ? line + ' ' + word : word;
          if (candidate.length > 76) {
            console.log(`  ${clr.cyan('[THOUGHT]')} ${clr.dim(line)}`);
            line = word;
          } else {
            line = candidate;
          }
        }
        if (line) console.log(`  ${clr.cyan('[THOUGHT]')} ${clr.dim(line)}`);
      }

      // ── No tool calls — agent is reasoning; let it continue freely ───────
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        // Only nudge on a completely empty response (no content either)
        if (!assistantMsg.content || assistantMsg.content.trim().length === 0) {
          log.warn('agent', 'Empty response — nudging agent to continue.');
          messages.push({
            role:    'user',
            content: 'Continue your analysis. Use a tool, or call `finish` when you are satisfied.',
          });
        }
        // Reasoning was already displayed above — just loop
        continue;
      }

      // ── ACTION + OBSERVATION for each tool call ───────────────────────────
      const toolResults: ToolResult[] = [];

      for (const raw of assistantMsg.tool_calls) {
        const toolCall = this.parseToolCall(raw);

        // Show the ACTION
        console.log(`\n  ${clr.magenta('[ACTION]')}  ${clr.cyan(toolCall.name)}  ${clr.dim(JSON.stringify(toolCall.arguments).slice(0, 100))}`);
        state.toolsUsed.push(toolCall.name);

        const result = await this.executeTool(toolCall, state);

        // Show the OBSERVATION (first 3 lines)
        const obs = result.split('\n').slice(0, 3).join('  ·  ');
        console.log(`  ${clr.yellow('[OBS]')}    ${clr.dim(obs.slice(0, 120))}`);

        toolResults.push({ tool_call_id: toolCall.id, name: toolCall.name, content: result });

        if (toolCall.name === 'finish') {
          state.finished = true;
          try {
            const args = toolCall.arguments as any;
            if (args.recommended_actions) state.recommendedActions = args.recommended_actions;
            if (args.final_thoughts)      state.thoughts.push(args.final_thoughts);
          } catch {}
        }
      }

      // Feed observations back into the conversation
      for (const tr of toolResults) {
        messages.push({
          role:         'tool',
          content:      tr.content,
          tool_call_id: tr.tool_call_id,
          name:         tr.name,
        });
      }
    }

    if (!state.finished) {
      log.warn('agent', 'Agent did not call finish — rendering with collected data.');
    }

    const totalElapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
    this.renderFinalOutput(state, totalElapsed, messages.length);
  }

  // ─── AI call (provider-agnostic) ────────────────────────────────────────

  private async callAI(messages: AgentMessage[]): Promise<AgentMessage> {
    if (config.aiProvider === 'nvidia') {
      const client = new OpenAI({
        apiKey:  config.nvidia.apiKey,
        baseURL: config.nvidia.baseURL,
      });
      const res = await client.chat.completions.create({
        model:       config.nvidia.model,
        messages:    messages as any,
        tools:       TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens:  4096,
      });
      return this.normalizeOpenAIResponse(res.choices[0].message);

    } else if (config.aiProvider === 'github') {
      const res = await axios.post(
        `${config.github.endpoint}/chat/completions`,
        {
          model:       config.github.model,
          messages,
          tools:       TOOL_DEFINITIONS,
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens:  4096,
        },
        {
          headers: { Authorization: `Bearer ${config.github.token}` },
          timeout: 90_000,
        },
      );
      return this.normalizeOpenAIResponse(res.data.choices[0].message);

    } else {
      // Offline / Ollama — no native tool calling, simulate with JSON
      const toolNames = TOOL_DEFINITIONS.map(t => t.function.name).join(', ');
      const injected = [
        ...messages,
        {
          role: 'system' as const,
          content: `You have access to these tools: ${toolNames}.\nTo call a tool respond ONLY with valid JSON:\n{"tool":"<name>","args":{...}}\nTo call multiple tools, put each on its own line as a separate JSON object.`,
        },
      ];
      const res = await axios.post(
        `${config.aiEndpoint}/api/chat`,
        { model: config.aiModel, messages: injected, stream: false },
        { timeout: 120_000 },
      );
      const raw: string = res.data.message?.content ?? res.data.response ?? '';
      return this.parseOfflineToolResponse(raw);
    }
  }

  private normalizeOpenAIResponse(msg: any): AgentMessage {
    return {
      role:       'assistant',
      content:    msg.content ?? null,
      tool_calls: msg.tool_calls ?? undefined,
    };
  }

  private parseOfflineToolResponse(raw: string): AgentMessage {
    // Strip <think> blocks
    const cleaned = raw.includes('</think>')
      ? raw.split('</think>').pop()!.trim()
      : raw.trim();

    const toolCalls: RawToolCall[] = [];
    const lines = cleaned.split('\n');

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed.tool && typeof parsed.tool === 'string') {
          toolCalls.push({
            id:       `offline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type:     'function',
            function: { name: parsed.tool, arguments: JSON.stringify(parsed.args ?? {}) },
          });
        }
      } catch {}
    }

    return {
      role:       'assistant',
      content:    toolCalls.length === 0 ? cleaned : null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private parseToolCall(raw: RawToolCall): ToolCall {
    let args: Record<string, any> = {};
    try { args = JSON.parse(raw.function.arguments); } catch {}
    return { id: raw.id, name: raw.function.name as ToolName, arguments: args };
  }

  // ─── Tool executor ────────────────────────────────────────────────────────

  private async executeTool(call: ToolCall, state: AgentState): Promise<string> {
    try {
      switch (call.name) {
        case 'fetch_news':           return await this.toolFetchNews(call.arguments, state);
        case 'fetch_price':          return await this.toolFetchPrice(call.arguments, state);
        case 'fetch_fear_greed':     return await this.toolFetchFearGreed(state);
        case 'fetch_trending_crypto': return await this.toolFetchTrendingCrypto(state);
        case 'search_news_by_asset': return this.toolSearchNewsByAsset(call.arguments, state);
        case 'summarize_findings':   return this.toolSummarizeFindings(call.arguments, state);
        case 'emit_opportunities':   return this.toolEmitOpportunities(call.arguments, state);
        case 'request_deeper_analysis': return this.toolRequestDeeperAnalysis(call.arguments, state);
        case 'finish':               return 'Analysis session marked as complete.';
        default:
          return `Unknown tool: ${call.name}`;
      }
    } catch (err: any) {
      return `Tool error (${call.name}): ${err.message}`;
    }
  }

  // ─── Individual Tools ─────────────────────────────────────────────────────

  private async toolFetchNews(args: any, state: AgentState): Promise<string> {
    if (!this.newsCache) {
      log.info('agent', '  Fetching all market news sources...');
      // Use the base analyzer's fetch pipeline by calling it internally
      // We replicate a lightweight fetch here to keep the agent self-contained
      this.newsCache = await this.fetchAllNewsData();
    }

    const focus: string = args.focus ?? 'all';
    const data = this.newsCache;
    const all: any[] = data.all ?? [];

    const high = all.filter((n: any) => n.impact === 'high').slice(0, 10);
    const med  = all.filter((n: any) => n.impact === 'medium').slice(0, 8);

    const lines: string[] = [
      `TOTAL NEWS ITEMS: ${all.length}`,
      `  crypto: ${(data.cryptocurrency ?? []).length}  |  stocks: ${(data.stocks ?? []).length}  |  economy: ${(data.economy ?? []).length}  |  commodities: ${(data.commodities ?? []).length}  |  oil: ${(data.oil ?? []).length}  |  forex: ${(data.forex ?? []).length}`,
      '',
      '── HIGH IMPACT ─────────────────────────────────',
    ];

    for (const n of high) {
      const assets = Array.isArray(n.assets) ? n.assets.join(', ') : '';
      lines.push(`[${n.category?.toUpperCase()}] ${n.title}`);
      if (assets) lines.push(`  assets: ${assets}`);
      if (n.sentiment) lines.push(`  sentiment: ${n.sentiment}`);
    }

    lines.push('', '── MEDIUM IMPACT ────────────────────────────────');
    for (const n of med) {
      lines.push(`[${n.category?.toUpperCase()}] ${n.title}`);
    }

    // Store for later asset searches
    state.collectedNews = all.map((n: any) => `[${n.category}] [${n.impact}] ${n.title} ${n.details ?? ''}`);

    return lines.join('\n');
  }

  private async toolFetchPrice(args: any, state: AgentState): Promise<string> {
    const asset: string = args.asset ?? '';
    if (!asset) return 'Error: asset argument is required.';

    const upper = asset.trim().toUpperCase();
    const symbol = SYMBOL_MAP[upper] ?? ((/^[A-Z]{1,5}$/.test(upper) || /^[A-Z]{2,8}-USD$/.test(upper)) ? upper : null);
    if (!symbol) return `Cannot resolve "${asset}" to a known ticker.`;

    state.fetchedAssets.add(upper);

    try {
      const quote = await yahooFinance.quote(symbol);
      const price  = (quote as any).regularMarketPrice;
      const change = (quote as any).regularMarketChangePercent;
      const high52 = (quote as any).fiftyTwoWeekHigh;
      const low52  = (quote as any).fiftyTwoWeekLow;
      const name   = (quote as any).longName ?? (quote as any).shortName ?? symbol;

      const lines = [
        `LIVE PRICE: ${name} (${symbol})`,
        `  price:    $${price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
        `  24h chg:  ${change != null ? (change > 0 ? '+' : '') + change.toFixed(2) + '%' : 'n/a'}`,
        `  52w high: ${high52 != null ? '$' + high52.toLocaleString() : 'n/a'}`,
        `  52w low:  ${low52  != null ? '$' + low52.toLocaleString()  : 'n/a'}`,
      ];

      // Distance from 52w high (late-entry indicator)
      if (price && high52) {
        const pct = ((high52 - price) / high52 * 100).toFixed(1);
        lines.push(`  from 52w high: -${pct}%`);
        if (parseFloat(pct) < 5) lines.push(`  [WARNING] Within 5% of 52-week high — possible late-entry risk.`);
      }

      return lines.join('\n');
    } catch (err: any) {
      return `Failed to fetch price for ${asset}: ${err.message}`;
    }
  }

  private async toolFetchFearGreed(state: AgentState): Promise<string> {
    const headers = this.headers;
    try {
      const res = await axios.get('https://api.alternative.me/fng/?limit=7', { headers, timeout: 5000 });
      const data = res.data?.data ?? [];
      if (data.length === 0) return 'Fear & Greed data unavailable.';

      const latest  = data[0];
      const values: number[] = data.map((d: any) => parseInt(d.value ?? '50', 10));
      const avg7d   = (values.reduce((a: number, b: number) => a + b, 0) / values.length).toFixed(1);
      const current = parseInt(latest.value, 10);
      const label   = latest.value_classification ?? 'Unknown';
      const momentum =
        values[0] > parseFloat(avg7d) + 5 ? 'RISING_GREED' :
        values[0] < parseFloat(avg7d) - 5 ? 'RISING_FEAR'  : 'STABLE';

      const interpretation =
        current <= 25 ? 'EXTREME_FEAR [contrarian BUY setup] crowd is panicking' :
        current <= 40 ? 'FEAR [cautious crowd] favour buy-dip setups with confirmation' :
        current <= 60 ? 'NEUTRAL [follow technical trend] crowd not at an extreme' :
        current <= 75 ? 'GREED [reduce conviction on new longs] tighten stops' :
            'EXTREME_GREED [contrarian SELL signal] crowd is euphoric';

      return [
        `FEAR & GREED INDEX`,
        `  current:    ${current}/100 (${label})`,
        `  7d average: ${avg7d}`,
        `  7d trend:   ${values.join(' | ')}`,
        `  momentum:   ${momentum}`,
        ``,
        `INTERPRETATION: ${interpretation}`,
        `NOTE: At extremes (< 25 or > 75) the crowd is almost always wrong. Treat as a reversal signal, not confirmation.`,
      ].join('\n');
    } catch {
      // Fallback to CNN
      try {
        const res = await axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', { headers, timeout: 5000 });
        const score  = res.data?.fear_and_greed?.score;
        const rating = res.data?.fear_and_greed?.rating;
        return `FEAR & GREED (CNN fallback)\n  score: ${Math.round(score)}/100 (${rating})\n  7d trend: unavailable`;
      } catch {
        return 'Fear & Greed data unavailable from both sources.';
      }
    }
  }

  private async toolFetchTrendingCrypto(state: AgentState): Promise<string> {
    const headers = this.headers;
    const lines: string[] = ['TRENDING CRYPTO (CoinGecko)'];

    try {
      const trending = await axios.get('https://api.coingecko.com/api/v3/search/trending', { headers, timeout: 5000 });
      const coins = trending.data?.coins ?? [];
      lines.push('  Top trending by search:');
      for (const c of coins.slice(0, 7)) {
        lines.push(`    ${c.item.name} (${c.item.symbol}) — rank #${c.item.market_cap_rank}`);
      }
    } catch { lines.push('  Trending data unavailable.'); }

    try {
      const markets = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h',
        { headers, timeout: 5000 },
      );
      let bull = 0, bear = 0;
      lines.push('\n  Top-10 by market cap (24h):');
      for (const coin of (markets.data ?? [])) {
        const chg = coin.price_change_percentage_24h ?? 0;
        const arrow = chg > 0 ? 'UP' : 'DOWN';
        if (chg > 0) bull++; else bear++;
        lines.push(`    ${coin.symbol.toUpperCase().padEnd(6)} $${coin.current_price?.toLocaleString()}  ${arrow} ${Math.abs(chg).toFixed(2)}%`);
      }
      lines.push(`\n  Crowd breadth: ${bull} bullish / ${bear} bearish of top-10`);
      if (bull >= 8) lines.push('  [WARNING] Extreme crypto breadth — possible crowded long.');
      if (bear >= 8) lines.push('  [WARNING] Extreme crypto selling — possible crowded short / capitulation.');
    } catch { lines.push('  Market data unavailable.'); }

    return lines.join('\n');
  }

  private toolSearchNewsByAsset(args: any, state: AgentState): string {
    const keyword: string = (args.asset ?? '').toLowerCase();
    const limit:   number = args.limit ?? 10;
    if (!keyword) return 'Error: asset argument is required.';

    const matches = state.collectedNews
      .filter(line => line.toLowerCase().includes(keyword))
      .slice(0, limit);

    if (matches.length === 0) return `No news found mentioning "${args.asset}".`;

    const lateCount = matches.filter(l => LATE_KEYWORDS.some(k => l.toLowerCase().includes(k))).length;
    const result = [`NEWS FOR "${args.asset.toUpperCase()}" (${matches.length} items):`, ...matches];
    if (lateCount > 0) result.push(`\n[WARNING] ${lateCount} headline(s) contain late-entry language — momentum may be extended.`);
    return result.join('\n');
  }

  private toolSummarizeFindings(args: any, state: AgentState): string {
    state.marketRegime  = args.market_regime  ?? state.marketRegime;
    state.marketSummary = args.market_summary ?? state.marketSummary;
    if (Array.isArray(args.key_themes))   state.thoughts.push(...args.key_themes);
    if (Array.isArray(args.contrarian))   state.contrarian.push(...args.contrarian);
    if (Array.isArray(args.risk_warnings)) state.riskWarnings.push(...args.risk_warnings);

    log.info('agent', `  regime: ${state.marketRegime}`);

    return [
      `[OK] Findings recorded.`,
      `  regime:  ${state.marketRegime}`,
      `  summary: ${state.marketSummary.slice(0, 120)}...`,
      `  themes recorded:  ${state.thoughts.length}`,
      `  risks recorded:   ${state.riskWarnings.length}`,
      `  contrarian noted: ${state.contrarian.length}`,
    ].join('\n');
  }

  private toolEmitOpportunities(args: any, state: AgentState): string {
    const opps: any[] = Array.isArray(args.opportunities) ? args.opportunities : [];
    if (opps.length === 0) return 'No opportunities provided.';

    const added: string[] = [];
    for (const o of opps) {
      const opp: AgentOpportunity = {
        asset:        String(o.asset ?? ''),
        asset_type:   String(o.asset_type ?? 'unknown'),
        action:       (String(o.action ?? 'WATCH').toUpperCase()) as 'BUY' | 'SELL' | 'WATCH',
        confidence:   Number(o.confidence ?? 50),
        reasoning:    String(o.reasoning ?? ''),
        entry_range:  String(o.entry_range ?? ''),
        target_range: String(o.target_range ?? ''),
        stop_loss:    String(o.stop_loss ?? ''),
        invalidation: String(o.invalidation ?? ''),
        risks:        String(o.risks ?? ''),
        late_signal:  String(o.late_signal ?? 'NO'),
      };
      state.opportunities.push(opp);
      added.push(`${opp.action} ${opp.asset} (confidence: ${opp.confidence}%)`);
      log.info('agent', `  + opportunity: ${opp.action} ${opp.asset} @ ${opp.confidence}%`);
    }

    return `[OK] Recorded ${added.length} opportunity/ies:\n${added.map(a => '  - ' + a).join('\n')}`;
  }

  private toolRequestDeeperAnalysis(args: any, state: AgentState): string {
    const reason = String(args.reason ?? '');
    const next: string[] = Array.isArray(args.next_actions) ? args.next_actions : [];
    state.thoughts.push(`[DEEPER ANALYSIS REQUESTED] ${reason}`);
    log.info('agent', `  deeper analysis: ${reason.slice(0, 80)}`);
    return [
      `[OK] Deeper analysis flagged.`,
      `  reason: ${reason}`,
      `  planned next: ${next.join(', ')}`,
      `  Continue with your planned tool calls.`,
    ].join('\n');
  }

  // ─── Internal news fetch (lightweight, used by toolFetchNews) ─────────────

  private async fetchAllNewsData(): Promise<Record<string, any>> {
    // Delegate entirely to the base NewsIntelAnalyzer's internal fetch
    // We access it by invoking the same public surface it uses internally
    // Since fetchAllNews is private, we run a minimal parallel fetch here

    const headers = this.headers;
    const allNews: Record<string, any> = {
      cryptocurrency: [], stocks: [], commodities: [], oil: [], forex: [], economy: [], all: [],
    };

    // ── CoinGecko trending ──────────────────────────────────────────────
    try {
      const res = await axios.get('https://api.coingecko.com/api/v3/search/trending', { headers, timeout: 5000 });
      for (const coin of (res.data?.coins ?? []).slice(0, 10)) {
        allNews.cryptocurrency.push({
          category: 'cryptocurrency', type: 'trending', impact: 'medium',
          title: `${coin.item.name} (${coin.item.symbol}) trending — rank #${coin.item.market_cap_rank}`,
          details: `Score: ${coin.item.score}`, source: 'CoinGecko',
          assets: [coin.item.symbol.toUpperCase()], timestamp: new Date().toISOString(),
        });
      }
    } catch {}

    // ── CryptoCompare ───────────────────────────────────────────────────
    try {
      const res = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN', { headers, timeout: 5000 });
      const highKw = ['regulation', 'sec', 'etf', 'approved', 'banned', 'hack', 'lawsuit', 'crash', 'surge', 'billion', 'fed', 'rate'];
      const medKw  = ['partnership', 'launch', 'update', 'upgrade', 'adoption', 'institutional'];
      const ccData = Array.isArray(res.data?.Data) ? res.data.Data : [];
      for (const art of ccData.slice(0, 15)) {
        const blob   = `${art.title ?? ''} ${art.body ?? ''}`.toLowerCase();
        const impact: 'high' | 'medium' | 'low' =
          highKw.some(k => blob.includes(k)) ? 'high' :
          medKw.some(k => blob.includes(k))  ? 'medium' : 'low';
        const cats = (art.categories ?? '').toUpperCase().split('|').filter((c: string) => c.trim().length <= 5 && c.trim().length > 0);
        allNews.cryptocurrency.push({
          category: 'cryptocurrency', type: 'news', impact,
          title: art.title ?? '', details: (art.body ?? '').substring(0, 300),
          source: art.source ?? 'CryptoCompare', url: art.url,
          timestamp: new Date((art.published_on ?? 0) * 1000).toISOString(),
          assets: cats.length > 0 ? cats.slice(0, 5) : ['BTC', 'ETH'],
        });
      }
    } catch {}

    // ── RSS feeds ───────────────────────────────────────────────────────
    const feeds: Record<string, string[]> = {
      stocks:      ['https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,AAPL,MSFT,NVDA&region=US&lang=en-US', 'https://www.marketwatch.com/rss/topstories'],
      commodities: ['https://feeds.feedburner.com/CommodityHQ', 'https://www.kitco.com/rss/kitconews.xml'],
      oil:         ['https://oilprice.com/rss/main'],
      forex:       ['https://www.fxstreet.com/rss/news'],
      economy:     ['https://www.cnbc.com/id/100003114/device/rss/rss.html', 'https://feeds.reuters.com/reuters/businessNews'],
    };

    const parser = new (await import('rss-parser')).default();
    const highKw = ['breaking', 'urgent', 'crash', 'surge', 'billion', 'regulation', 'approved', 'banned', 'record', 'historic'];
    const medKw  = ['announces', 'launches', 'partnership', 'update', 'report', 'forecasts', 'warns'];

    await Promise.allSettled(
      Object.entries(feeds).flatMap(([category, urls]) =>
        urls.map(async (url) => {
          try {
            const feed = await parser.parseURL(url);
            for (const entry of (feed.items ?? []).slice(0, 8)) {
              const title  = (entry.title ?? '').toLowerCase();
              const impact: 'high' | 'medium' | 'low' =
                highKw.some(k => title.includes(k)) ? 'high' :
                medKw.some(k => title.includes(k))  ? 'medium' : 'low';
              allNews[category]?.push({
                category, type: 'news', impact,
                title: entry.title ?? '', details: (entry.contentSnippet ?? '').substring(0, 300),
                source: feed.title ?? 'RSS', url: entry.link, timestamp: entry.pubDate ?? new Date().toISOString(),
              });
            }
          } catch {}
        }),
      ),
    );

    // ── Alpha Vantage (optional) ────────────────────────────────────────
    if (process.env.ALPHA_VANTAGE_API_KEY) {
      try {
        const res = await axios.get(
          `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`,
          { headers, timeout: 5000 },
        );
        for (const art of (res.data?.feed ?? []).slice(0, 10)) {
          allNews.stocks.push({
            category: 'stocks', type: 'news',
            impact: Math.abs(parseFloat(art.overall_sentiment_score ?? '0')) > 0.5 ? 'high' : 'medium',
            title: art.title ?? '', details: (art.summary ?? '').substring(0, 300),
            source: art.source ?? 'Alpha Vantage', url: art.url,
            timestamp: art.time_published ?? new Date().toISOString(),
            sentiment: art.overall_sentiment_label ?? 'Neutral',
            assets: (art.ticker_sentiment ?? []).slice(0, 5).map((t: any) => t.ticker),
          });
        }
      } catch {}
    }

    // ── Finnhub (optional) ──────────────────────────────────────────────
    if (process.env.FINNHUB_API_KEY) {
      try {
        const res = await axios.get(
          `https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`,
          { headers, timeout: 5000 },
        );
        const macroKw = ['fed', 'rate', 'inflation', 'recession', 'earnings', 'ipo', 'fomc', 'cpi', 'gdp', 'nfp'];
        for (const art of (res.data ?? []).slice(0, 10)) {
          const t = (art.headline ?? '').toLowerCase();
          allNews.stocks.push({
            category: 'stocks', type: 'news',
            impact: macroKw.some(w => t.includes(w)) ? 'high' : 'medium',
            title: art.headline ?? '', details: (art.summary ?? '').substring(0, 300),
            source: art.source ?? 'Finnhub', url: art.url,
            timestamp: new Date((art.datetime ?? 0) * 1000).toISOString(),
            assets: (art.related ?? '').split(',').slice(0, 5).filter(Boolean),
          });
        }
      } catch {}
    }

    // ── FRED (optional) ─────────────────────────────────────────────────
    if (process.env.FRED_API_KEY) {
      try {
        const res = await axios.get(
          `https://api.stlouisfed.org/fred/releases?api_key=${process.env.FRED_API_KEY}&file_type=json&limit=10`,
          { headers, timeout: 5000 },
        );
        for (const r of (res.data?.releases ?? []).slice(0, 10)) {
          allNews.economy.push({
            category: 'economy', type: 'economic_release', impact: 'high',
            title: r.name ?? '', details: `Federal Reserve economic data release: ${r.name}`,
            source: 'FRED', timestamp: new Date().toISOString(), assets: ['SPY', 'DXY', 'TLT'],
          });
        }
      } catch {}
    }

    // ── Merge & sort ────────────────────────────────────────────────────
    allNews.all = [
      ...allNews.cryptocurrency, ...allNews.stocks,
      ...allNews.commodities, ...allNews.oil, ...allNews.forex, ...allNews.economy,
    ];
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    allNews.all.sort((a: any, b: any) => (order[a.impact ?? 'low'] ?? 2) - (order[b.impact ?? 'low'] ?? 2));

    log.ok('agent', `News fetched: ${allNews.all.length} items (crypto ${allNews.cryptocurrency.length} · stocks ${allNews.stocks.length} · economy ${allNews.economy.length} · commodities ${allNews.commodities.length} · oil ${allNews.oil.length} · forex ${allNews.forex.length})`);
    return allNews;
  }

  // ─── Prompts ──────────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `You are an elite autonomous cross-asset macro research agent with access to real-time market tools.

You are NOT a chatbot that responds to commands. You are an independent thinker who decides your own investigation path, follows wherever the data leads, and concludes only when YOU are satisfied you have a complete, well-evidenced market picture.

─── YOUR NATURE ─────────────────────────────────────────────────────────────────

You reason freely. Between tool calls you think aloud — share your hypotheses, doubts, and the connections you are drawing. This thinking is visible to the user and is valued. Do not suppress it.

You follow evidence, not a script. If the news reveals an unexpected theme, pursue it. If a price level surprises you, investigate why. If two signals conflict, dig until you resolve the conflict — or honestly report the uncertainty.

You call finish only when YOU decide you are done. There is no rush. There is no step limit. Take as many steps as your analysis requires.

─── TOOLS ───────────────────────────────────────────────────────────────────────

• fetch_news            — broad sweep across crypto, stocks, macro, commodities, forex
• fetch_fear_greed      — crypto crowd sentiment 0-100 with 7-day trend
• fetch_trending_crypto — what the crypto crowd is chasing right now
• fetch_price           — live price for any asset (crypto, stock, commodity, forex, index)
• search_news_by_asset  — filter fetched news for a specific asset or keyword
• summarize_findings    — checkpoint your regime assessment and key themes
• emit_opportunities    — record a specific trade setup with full parameters
• request_deeper_analysis — flag a divergence you want to investigate further
• finish                — end the session and deliver final recommendations

Call any tool at any time, in any order, as many times as you like.
Call multiple tools in a single step if it helps.
Do NOT repeat the exact same call with the same arguments twice.

─── ANALYTICAL STANDARDS ────────────────────────────────────────────────────────

PROPAGATION — trace the full causal chain for significant events:
  first-order → second-order → third-order effects.
  Example: Oil +5% → energy stocks rise → airlines fall → CPI pressured
           → DXY strengthens → gold pressured → EM currencies weaker.

CONFIDENCE:
  > 80%  : cite 3 independent confirming signals explicitly.
  65-80% : 2 confirming signals with clear directional bias.
  50-65% : conflicting signals → use WATCH with a specific trigger.
  < 50%  : do NOT emit as an opportunity.

LATE ENTRY: if a move is parabolic or near its 52-week high, set late_signal YES and action WATCH.

CROWD CONTRARIANISM:
  Fear & Greed > 75 → crowd euphoric → fade longs, look for SELL setups.
  Fear & Greed < 25 → crowd panicking → fade shorts, look for BUY setups.

INVALIDATION: every BUY or SELL must name a specific price level or event that would disprove the thesis. "If sentiment changes" is not acceptable.`;
  }

  private buildInitialPrompt(): string {
    const date = new Date().toISOString().split('T')[0];
    return `Today is ${date}. Begin your autonomous market analysis.

You have no prescribed order. Start wherever feels right — a broad news sweep, a sentiment check, or a specific asset you are curious about. Reason aloud as you go. Follow what surprises you. Dig into contradictions.

Your goal: find the 3-7 highest-conviction trade setups across all asset classes — crypto, stocks, commodities, forex, indices. The best opportunities are often in the quiet corners of the market, not the loudest headlines.

When you are genuinely satisfied with the depth and quality of your analysis, call finish.`;
  }

  // ─── Final Renderer ───────────────────────────────────────────────────────

  private renderFinalOutput(state: AgentState, elapsed: string, totalMessages: number): void {
    const W     = 78;
    const heavy = clr.dim('━'.repeat(W));
    const light = clr.dim('─'.repeat(W));
    const br    = () => console.log('');

    const wrapText = (text: string, width = W - 4): string[] => {
      const words = (text ?? '').trim().split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        if (!cur) { cur = w; continue; }
        if ((cur + ' ' + w).length <= width) cur += ' ' + w;
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : [''];
    };

    br();
    console.log(heavy);
    console.log(clr.magenta('  [AGENT] AGENTIC NEWS INTEL — FINAL ANALYSIS'));
    console.log(clr.dim(`     ${elapsed}s elapsed · ${state.iteration} iterations · ${state.toolsUsed.length} tool calls · ${totalMessages} messages`));
    console.log(heavy);

    // ── Regime ──────────────────────────────────────────────────────────
    const regime = (state.marketRegime ?? 'UNKNOWN').toUpperCase();
    const rClr   = regime.includes('RISK_ON') ? clr.green : regime.includes('RISK_OFF') ? clr.red : clr.yellow;
    br();
    console.log(`  ${rClr('REGIME')}  ${rClr(regime)}`);
    br();

    // ── Market Summary ────────────────────────────────────────────────────
    if (state.marketSummary) {
      console.log(light);
      console.log(clr.white('  MARKET SUMMARY'));
      console.log(light);
      br();
      wrapText(state.marketSummary).forEach(l => console.log(`  ${clr.dim(l)}`));
      br();
    }

    // ── Agent Reasoning Chain ─────────────────────────────────────────────
    const meaningfulThoughts = state.thoughts.filter(t => t.length > 20);
    if (meaningfulThoughts.length > 0) {
      console.log(light);
      console.log(clr.cyan('  AGENT REASONING CHAIN'));
      console.log(light);
      br();
      for (const t of meaningfulThoughts.slice(0, 8)) {
        wrapText(t).forEach((l, i) => console.log(`  ${i === 0 ? clr.cyan('[THOUGHT]') : ' '}  ${clr.dim(l)}`));
        br();
      }
    }

    // ── Opportunities ─────────────────────────────────────────────────────
    if (state.opportunities.length > 0) {
      console.log(light);
      console.log(clr.white('  OPPORTUNITIES'));
      console.log(light);

      for (const [idx, o] of state.opportunities.entries()) {
        const action  = (o.action ?? 'WATCH').toUpperCase() as 'BUY' | 'SELL' | 'WATCH';
        const aClr    = action === 'BUY' ? clr.green : action === 'SELL' ? clr.red : clr.yellow;
        const conf    = Number(o.confidence ?? 0);
        const confStr = conf >= 75 ? clr.green(conf + '%') : conf >= 50 ? clr.yellow(conf + '%') : clr.red(conf + '%');
        const spotStr = o.spot_price != null ? clr.dim(`  spot $${o.spot_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`) : '';
        const isLate  = String(o.late_signal).toUpperCase().startsWith('YES');

        br();
        console.log(`  ${clr.dim(String(idx + 1).padStart(2, '0'))}  [OPP] ${clr.white(o.asset)} ${clr.dim('[' + o.asset_type + ']')}  ${aClr(action)}  ${confStr}${spotStr}`);
        if (o.reasoning) wrapText(o.reasoning).forEach(l => console.log(`      ${clr.dim(l)}`));

        const levels = [
          o.entry_range  ? `entry  ${o.entry_range}`  : '',
          o.target_range ? `target ${o.target_range}` : '',
          o.stop_loss    ? `stop   ${o.stop_loss}`    : '',
        ].filter(Boolean);
        if (levels.length) console.log(`      ${clr.dim(levels.join('   '))}`);

        if (o.late_signal) {
          const lClr = isLate ? clr.red : clr.green;
          console.log(`      ${clr.dim('[LATE]')}    ${lClr(o.late_signal)}`);
        }
        if (o.invalidation) wrapText(`invalidates if: ${o.invalidation}`).forEach(l => console.log(`      ${clr.dim(l)}`));
        if (o.risks)        wrapText(`risks: ${o.risks}`).forEach(l => console.log(`      ${clr.dim(l)}`));
      }
      br();
    } else {
      br();
      console.log(clr.yellow('  No high-conviction opportunities identified in this session.'));
      br();
    }

    // ── Contrarian Signals ────────────────────────────────────────────────
    if (state.contrarian.length > 0) {
      console.log(light);
      console.log(clr.magenta('  CONTRARIAN SIGNALS'));
      console.log(light);
      br();
      for (const s of state.contrarian) {
        wrapText(s).forEach((l, i) => console.log(`  ${i === 0 ? clr.magenta('[CONTRARIAN]') : ' '}  ${l}`));
        br();
      }
    }

    // ── Risk Warnings ─────────────────────────────────────────────────────
    if (state.riskWarnings.length > 0) {
      console.log(light);
      console.log(clr.red('  [RISK WARNINGS]'));
      console.log(light);
      br();
      for (const r of state.riskWarnings) {
        wrapText(r).forEach((l, i) => console.log(`  ${i === 0 ? clr.red('[RISK]') : ' '}  ${clr.red(l)}`));
        br();
      }
    }

    // ── Recommended Actions ───────────────────────────────────────────────
    if (state.recommendedActions.length > 0) {
      console.log(light);
      console.log(clr.green('  RECOMMENDED ACTIONS'));
      console.log(light);
      br();
      for (const a of state.recommendedActions) {
        wrapText(a).forEach((l, i) => console.log(`  ${i === 0 ? clr.green('[ACTION]') : ' '}  ${l}`));
        br();
      }
    }

    // ── Tool Usage Summary ────────────────────────────────────────────────
    console.log(light);
    const toolCounts: Record<string, number> = {};
    for (const t of state.toolsUsed) toolCounts[t] = (toolCounts[t] ?? 0) + 1;
    const toolSummary = Object.entries(toolCounts).map(([k, v]) => `${k} ×${v}`).join('  ');
    console.log(clr.dim(`  tools used: ${toolSummary}`));
    console.log(clr.dim(`  assets checked: ${Array.from(state.fetchedAssets).join(', ') || 'none'}`));
    console.log(heavy);
    br();
  }
}
