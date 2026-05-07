// ─── agents/news.intel.agent.ts ───────────────────────────────────────────────
// Agentic (ReAct loop) news intelligence agent.
// Extends BaseAgent — all AI dispatch, loop, and rendering is inherited.
// All fetching → NewsFetchService  |  symbol/late logic → shared/
//
// Improvements over v1:
//   • synthesiseFinish() is public so BaseAgent's error-exit hook can call it
//   • toolFetchNews() delegates fully to the NewsFetchService singleton
//     (no duplicate cache; two agents running simultaneously share one copy)
//   • generateSessionSummary() falls back to inline marketSummary on AI error
//   • renderFinalOutput() prints marketSummary even when metaSummary is empty

import axios from 'axios';
import { log, clr }                    from '../utils/logger.js';
import { yahooFinance }                from '../services/yahoo.service.js';
import { newsFetchService, AllNewsData } from '../services/news.fetch.service.js';
import { resolveSymbol, LATE_KEYWORDS } from '../shared/market-constants.js';
import { BaseAgent, ParsedToolCall }   from './base.agent.js';

// ─── Agent-specific types ─────────────────────────────────────────────────────

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
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

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
          asset: { type: 'string', description: 'Asset name, ticker, or topic keyword.' },
          limit: { type: 'number', description: 'Max headlines to return (default 10).' },
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
          market_regime:  { type: 'string', enum: ['RISK_ON', 'RISK_OFF', 'TRANSITION'] },
          market_summary: { type: 'string', description: '2-3 sentence synthesis of dominant cross-asset theme.' },
          key_themes:     { type: 'array', items: { type: 'string' } },
          contrarian:     { type: 'array', items: { type: 'string' } },
          risk_warnings:  { type: 'array', items: { type: 'string' } },
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
                target_range: { type: 'string' },
                stop_loss:    { type: 'string' },
                invalidation: { type: 'string', description: 'The specific condition that would flip this thesis.' },
                risks:        { type: 'string', description: 'Comma-separated list of 2-3 risks.' },
                late_signal:  { type: 'string', enum: ['YES', 'NO'] },
              },
              required: ['asset', 'asset_type', 'action', 'confidence', 'reasoning',
                         'entry_range', 'target_range', 'stop_loss', 'invalidation', 'risks', 'late_signal'],
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
      description: 'Signal that you want to investigate further before concluding. Use this when you have spotted something that needs more data.',
      parameters: {
        type: 'object',
        properties: {
          reason:       { type: 'string' },
          next_actions: { type: 'array', items: { type: 'string' } },
        },
        required: ['reason', 'next_actions'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish',
      description: 'End the analysis session and produce the final output. Call this ONLY when you have: (1) fetched broad market data, (2) checked fear/greed, (3) investigated at least 2-3 specific assets, (4) recorded a market summary, and (5) emitted all identified opportunities.',
      parameters: {
        type: 'object',
        properties: {
          recommended_actions: { type: 'array', items: { type: 'string' } },
          final_thoughts:      { type: 'string' },
        },
        required: ['recommended_actions'],
      },
    },
  },
];

// ─── NewsIntelAgent ───────────────────────────────────────────────────────────

export class NewsIntelAgent extends BaseAgent {
  private readonly headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  };

  // Cached raw news data — fetched once, then re-used from the singleton
  private newsCache: AllNewsData | null = null;

  // ─── Entry point ────────────────────────────────────────────────────────

  public async runAnalysis(): Promise<void> {
    log.info('agent', 'Starting Agentic News Intel...');

    const state: AgentState = {
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
    };

    const { iterations, elapsed } = await this.runLoop(
      state,
      (s: AgentState) => s.finished,
      (args, s: AgentState) => {
        s.finished = true;
        if (args.recommended_actions) s.recommendedActions = args.recommended_actions;
        if (args.final_thoughts)      s.thoughts.push(args.final_thoughts);
      },
      'AGENTIC NEWS INTEL',
    );

    // runLoop's error-exit hook calls synthesiseFinish via (this as any).
    // This second call handles the clean non-error case where the agent
    // simply ran out of iterations without calling finish.
    if (!state.finished) this.synthesiseFinish(state);

    const elapsedSec = (elapsed / 1000).toFixed(1);
    log.ok('agent', `Done — ${iterations} iterations, ${elapsedSec}s`);

    log.info('agent', 'Generating final AI meta-summary...');
    const metaSummary = await this.generateSessionSummary(state);

    this.renderFinalOutput(state, elapsedSec, metaSummary);
  }

  // ─── BaseAgent abstract implementations ─────────────────────────────────

  protected getToolDefinitions(): object[] {
    return TOOL_DEFINITIONS;
  }

  protected async executeTool(call: ParsedToolCall, state: AgentState): Promise<string> {
    try {
      switch (call.name) {
        case 'fetch_news':              return await this.toolFetchNews(call.arguments, state);
        case 'fetch_price':             return await this.toolFetchPrice(call.arguments, state);
        case 'fetch_fear_greed':        return await this.toolFetchFearGreed();
        case 'fetch_trending_crypto':   return await this.toolFetchTrendingCrypto();
        case 'search_news_by_asset':    return this.toolSearchNewsByAsset(call.arguments, state);
        case 'summarize_findings':      return this.toolSummarizeFindings(call.arguments, state);
        case 'emit_opportunities':      return this.toolEmitOpportunities(call.arguments, state);
        case 'request_deeper_analysis': return this.toolRequestDeeperAnalysis(call.arguments, state);
        case 'finish':                  return 'Analysis session marked as complete.';
        default:                        return `Unknown tool: ${call.name}`;
      }
    } catch (err: any) {
      return `Tool error (${call.name}): ${err.message}`;
    }
  }

  protected buildSystemPrompt(): string {
    return `You are an elite autonomous cross-asset macro research agent with access to real-time market tools.

You are NOT a chatbot that responds to commands. You are an independent thinker who decides your own investigation path, follows wherever the data leads, and concludes only when YOU are satisfied you have a complete, well-evidenced market picture.

─── YOUR NATURE ─────────────────────────────────────────────────────────────────

You reason freely. Between tool calls you think aloud — share your hypotheses, doubts, and the connections you are drawing. This thinking is visible to the user and is valued. Do not suppress it.

You follow evidence, not a script. If the news reveals an unexpected theme, pursue it. If a price level surprises you, investigate why. If two signals conflict, dig until you resolve the conflict — or honestly report the uncertainty.

You call finish only when YOU decide you are done. There is no rush. There is no step limit. Take as many steps as your analysis requires.

─── HOW TO THINK — MANDATORY REFLECTION PROTOCOL ────────────────────────────────

After EVERY tool result, before calling the next tool, write a reflection in your text content using this structure:

  RECEIVED: [one sentence — what did the data actually show?]
  EXPECTED: [was this what you anticipated? yes / no — and why?]
  CHANGES:  [how does this update your thesis for this asset or the overall regime?]
  NEXT:     [what specific question does this raise that you need to answer next?]

If a result contradicts your prior hypothesis, say so explicitly: "I was wrong about X because the data shows Y." Never soften uncertainty with vague hedging.

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

─── ANALYTICAL STANDARDS ────────────────────────────────────────────────────────

PROPAGATION — trace the full causal chain:  first-order → second-order → third-order effects.
CONFIDENCE:  >80% = cite 3 independent signals.  65-80% = 2 signals.  50-65% = WATCH only.  <50% = skip.
LATE ENTRY:  if parabolic or near 52-week high → late_signal YES, action WATCH.
CROWD:       Fear & Greed >75 → fade longs.  <25 → fade shorts.
INVALIDATION: every BUY/SELL must name a specific price level or event that disproves the thesis.`;
  }

  protected buildInitialPrompt(): string {
    const date = new Date().toISOString().split('T')[0];
    return `Today is ${date}. Begin your autonomous market analysis.

Start wherever feels right — a broad news sweep, a sentiment check, or a specific asset you are curious about. Reason aloud as you go. Follow what surprises you. Dig into contradictions.

Your goal: find the 3-7 highest-conviction trade setups across all asset classes. When you are genuinely satisfied with the depth and quality of your analysis, call finish.`;
  }

  // ─── Tools ───────────────────────────────────────────────────────────────

  private async toolFetchNews(args: any, state: AgentState): Promise<string> {
    if (!this.newsCache) {
      log.info('agent', 'Fetching all market news via NewsFetchService...');
      // Re-use any data already cached by the singleton (disk + memory),
      // so two agents or back-to-back runs never double-fetch within the TTL.
      this.newsCache = await newsFetchService.fetchAll();
    }

    const data = this.newsCache;
    const all  = data.all;
    const high = all.filter(n => n.impact === 'high').slice(0, 10);
    const med  = all.filter(n => n.impact === 'medium').slice(0, 8);

    const lines: string[] = [
      `TOTAL NEWS ITEMS: ${all.length}`,
      `  crypto: ${data.cryptocurrency.length}  |  stocks: ${data.stocks.length}  |  economy: ${data.economy.length}  |  commodities: ${data.commodities.length}  |  oil: ${data.oil.length}  |  forex: ${data.forex.length}`,
      '',
      '── HIGH IMPACT ─────────────────────────────────',
    ];

    for (const n of high) {
      const assets = (n.assets ?? []).join(', ');
      lines.push(`[${n.category.toUpperCase()}] ${n.title}`);
      if (assets)      lines.push(`  assets: ${assets}`);
      if (n.sentiment) lines.push(`  sentiment: ${n.sentiment}`);
    }

    lines.push('', '── MEDIUM IMPACT ────────────────────────────────');
    for (const n of med) lines.push(`[${n.category.toUpperCase()}] ${n.title}`);

    // Cache flat news strings for search_news_by_asset
    state.collectedNews = all.map(n => `[${n.category}] [${n.impact}] ${n.title} ${n.details ?? ''}`);
    state.toolsUsed.push('fetch_news');

    return lines.join('\n');
  }

  private async toolFetchPrice(args: any, state: AgentState): Promise<string> {
    const asset: string = args.asset ?? '';
    if (!asset) return 'Error: asset argument is required.';

    const symbol = resolveSymbol(asset);
    if (!symbol) return `Cannot resolve "${asset}" to a known ticker.`;

    state.fetchedAssets.add(asset.trim().toUpperCase());
    state.toolsUsed.push('fetch_price');

    try {
      const quote  = await yahooFinance.quote(symbol);
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

      if (price && high52) {
        const pct = ((high52 - price) / high52 * 100).toFixed(1);
        lines.push(`  from 52w high: -${pct}%`);
        if (parseFloat(pct) < 5)
          lines.push(`  [WARNING] Within 5% of 52-week high — possible late-entry risk.`);
      }

      return lines.join('\n');
    } catch (err: any) {
      return `Failed to fetch price for ${asset}: ${err.message}`;
    }
  }

  private async toolFetchFearGreed(): Promise<string> {
    try {
      const res = await axios.get(
        'https://api.alternative.me/fng/?limit=7',
        { headers: this.headers, timeout: 5000 },
      );
      const data = res.data?.data ?? [];
      if (data.length === 0) return 'Fear & Greed data unavailable.';

      const latest  = data[0];
      const values: number[] = data.map((d: any) => parseInt(d.value ?? '50', 10));
      const avg7d   = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
      const current = parseInt(latest.value, 10);
      const label   = latest.value_classification ?? 'Unknown';
      const momentum =
        values[0] > parseFloat(avg7d) + 5 ? 'RISING_GREED' :
        values[0] < parseFloat(avg7d) - 5 ? 'RISING_FEAR'  : 'STABLE';

      const interpretation =
        current <= 25 ? 'EXTREME_FEAR [contrarian BUY setup] crowd is panicking'           :
        current <= 40 ? 'FEAR [cautious crowd] favour buy-dip setups with confirmation'    :
        current <= 60 ? 'NEUTRAL [follow technical trend] crowd not at an extreme'          :
        current <= 75 ? 'GREED [reduce conviction on new longs] tighten stops'             :
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
      try {
        const res = await axios.get(
          'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
          { headers: this.headers, timeout: 5000 },
        );
        const score  = res.data?.fear_and_greed?.score;
        const rating = res.data?.fear_and_greed?.rating;
        return `FEAR & GREED (CNN fallback)\n  score: ${Math.round(score)}/100 (${rating})\n  7d trend: unavailable`;
      } catch {
        return 'Fear & Greed data unavailable from both sources.';
      }
    }
  }

  private async toolFetchTrendingCrypto(): Promise<string> {
    const lines: string[] = ['TRENDING CRYPTO (CoinGecko)'];

    try {
      const res = await axios.get(
        'https://api.coingecko.com/api/v3/search/trending',
        { headers: this.headers, timeout: 5000 },
      );
      lines.push('  Top trending by search:');
      for (const c of (res.data?.coins ?? []).slice(0, 7)) {
        lines.push(`    ${c.item.name} (${c.item.symbol}) — rank #${c.item.market_cap_rank}`);
      }
    } catch { lines.push('  Trending data unavailable.'); }

    try {
      const res = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h',
        { headers: this.headers, timeout: 5000 },
      );
      let bull = 0, bear = 0;
      lines.push('\n  Top-10 by market cap (24h):');
      for (const coin of (res.data ?? [])) {
        const chg = coin.price_change_percentage_24h ?? 0;
        if (chg > 0) bull++; else bear++;
        lines.push(`    ${coin.symbol.toUpperCase().padEnd(6)} $${coin.current_price?.toLocaleString()}  ${chg > 0 ? 'UP' : 'DOWN'} ${Math.abs(chg).toFixed(2)}%`);
      }
      lines.push(`\n  Crowd breadth: ${bull} bullish / ${bear} bearish of top-10`);
      if (bull >= 8) lines.push('  [WARNING] Extreme crypto breadth — possible crowded long.');
      if (bear >= 8) lines.push('  [WARNING] Extreme crypto selling — possible crowded short / capitulation.');
    } catch { lines.push('  Market data unavailable.'); }

    return lines.join('\n');
  }

  private toolSearchNewsByAsset(args: any, state: AgentState): string {
    const keyword = (args.asset ?? '').toLowerCase();
    const limit   = args.limit ?? 10;
    if (!keyword) return 'Error: asset argument is required.';

    const matches = state.collectedNews
      .filter(l => l.toLowerCase().includes(keyword))
      .slice(0, limit);

    if (matches.length === 0) return `No news found mentioning "${args.asset}".`;

    const lateCount = matches.filter(l =>
      LATE_KEYWORDS.some(k => l.toLowerCase().includes(k)),
    ).length;

    const result = [`NEWS FOR "${args.asset.toUpperCase()}" (${matches.length} items):`, ...matches];
    if (lateCount > 0)
      result.push(`\n[WARNING] ${lateCount} headline(s) contain late-entry language — momentum may be extended.`);
    return result.join('\n');
  }

  private toolSummarizeFindings(args: any, state: AgentState): string {
    state.marketRegime  = args.market_regime  ?? state.marketRegime;
    state.marketSummary = args.market_summary ?? state.marketSummary;
    if (Array.isArray(args.key_themes))    state.thoughts.push(...args.key_themes);
    if (Array.isArray(args.contrarian))    state.contrarian.push(...args.contrarian);
    if (Array.isArray(args.risk_warnings)) state.riskWarnings.push(...args.risk_warnings);
    log.info('agent', `  regime: ${state.marketRegime}`);
    return [
      `[OK] Findings recorded.`,
      `  regime:  ${state.marketRegime}`,
      `  summary: ${state.marketSummary.slice(0, 120)}...`,
      `  themes:  ${state.thoughts.length}   risks: ${state.riskWarnings.length}   contrarian: ${state.contrarian.length}`,
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
    const next:  string[] = Array.isArray(args.next_actions) ? args.next_actions : [];
    state.thoughts.push(`[DEEPER ANALYSIS REQUESTED] ${reason}`);
    log.info('agent', `  deeper analysis: ${reason.slice(0, 80)}`);
    return [
      `[OK] Deeper analysis flagged.`,
      `  reason: ${reason}`,
      `  planned next: ${next.join(', ')}`,
      `  Continue with your planned tool calls.`,
    ].join('\n');
  }

  // ─── Graceful finish synthesiser ─────────────────────────────────────────
  // Public so BaseAgent's error-exit hook can call it via (this as any).synthesiseFinish()

  public synthesiseFinish(state: AgentState): void {
    state.finished = true;
    if (state.recommendedActions.length === 0) {
      if (state.opportunities.length > 0) {
        state.recommendedActions = state.opportunities
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 5)
          .map(o =>
            `${o.action} ${o.asset} (${o.confidence}% confidence) — ` +
            `entry ${o.entry_range}, target ${o.target_range}, stop ${o.stop_loss}`,
          );
      } else {
        state.recommendedActions = [
          `Market regime: ${state.marketRegime}. No high-conviction setups identified — wait for clearer signals.`,
        ];
      }
    }
    if (!state.marketSummary && state.thoughts.length > 0) {
      state.marketSummary = state.thoughts.filter(t => t.length > 40).slice(-3).join(' ');
    }
    state.thoughts.push(
      `[AUTO-FINISH] Session ended by safety guard after ${state.toolsUsed.length} tool calls. ` +
      `${state.opportunities.length} opportunit${state.opportunities.length === 1 ? 'y' : 'ies'} recorded. ` +
      (state.riskWarnings.length > 0 ? `Risks: ${state.riskWarnings.slice(0, 2).join('; ')}.` : ''),
    );
  }

  // ─── Post-session meta-summary ────────────────────────────────────────────

  private async generateSessionSummary(state: AgentState): Promise<string> {
    const oppLines = state.opportunities
      .sort((a, b) => b.confidence - a.confidence)
      .map(o => `  • ${o.action} ${o.asset} [${o.asset_type}] ${o.confidence}% — ${o.reasoning.slice(0, 200)}`)
      .join('\n');

    const prompt = [
      `You just completed a full autonomous market analysis session. Reflect candidly.`,
      ``,
      `REGIME: ${state.marketRegime}`,
      `SUMMARY: ${state.marketSummary || '(not recorded)'}`,
      ``,
      `OPPORTUNITIES (${state.opportunities.length}):`,
      oppLines || '  none recorded',
      ``,
      `RISKS: ${state.riskWarnings.join(' | ') || 'none'}`,
      `CONTRARIAN: ${state.contrarian.join(' | ') || 'none'}`,
      `TOOL CALLS: ${state.toolsUsed.length}`,
      ``,
      `Structure your reflection exactly as:`,
      ``,
      `DOMINANT THEMES`,
      `WHAT SURPRISED ME`,
      `HIGHEST CONVICTION CALL`,
      `OPEN UNCERTAINTIES`,
      `CONTRARIAN TAKE`,
      ``,
      `Rules: cite actual prices and percentages you observed. Be candid about uncertainty. Max 400 words.`,
    ].join('\n');

    try {
      return await this.callAIText([
        {
          role: 'system',
          content: 'You are a candid, rigorous market analyst completing a post-session debrief. Speak in first person. Be specific and honest.',
        },
        { role: 'user', content: prompt },
      ]);
    } catch (err: any) {
      log.warn('agent', `Meta-summary AI call failed: ${err.message}`);
      // Graceful fallback: return whatever the agent recorded inline
      const fallback = [
        state.marketSummary ? `DOMINANT THEMES\n${state.marketSummary}` : '',
        state.riskWarnings.length  ? `OPEN UNCERTAINTIES\n${state.riskWarnings.join('\n')}` : '',
        state.contrarian.length    ? `CONTRARIAN TAKE\n${state.contrarian.join('\n')}`      : '',
      ].filter(Boolean).join('\n\n');
      return fallback || '';
    }
  }

  // ─── Final renderer ───────────────────────────────────────────────────────

  private renderFinalOutput(
    state:       AgentState,
    elapsed:     string,
    metaSummary: string,
  ): void {
    const W     = 78;
    const light = clr.dim('─'.repeat(W));
    const br    = () => console.log('');

    br();
    console.log(clr.magenta('  [AGENT] FINAL ANALYSIS'));
    console.log(clr.dim(`  ${elapsed}s · ${state.toolsUsed.length} tool calls · ${state.opportunities.length} opportunities`));
    br();

    const regime = (state.marketRegime ?? 'UNKNOWN').toUpperCase();
    const rClr   = regime.includes('RISK_ON') ? clr.green : regime.includes('RISK_OFF') ? clr.red : clr.yellow;
    console.log(`  ${rClr('REGIME')}  ${rClr(regime)}`);
    br();

    if (metaSummary.trim()) {
      console.log(clr.cyan('  AI META-SUMMARY'));
      br();
      for (const ml of metaSummary.trim().split('\n')) {
        const t = ml.trim();
        if (!t) { br(); continue; }
        if (/^[A-Z][A-Z ]{3,}$/.test(t)) console.log(`  ${clr.cyan(t)}`);
        else this.wrapText(t).forEach(l => console.log(`  ${clr.dim(l)}`));
      }
      br();
    } else if (state.marketSummary) {
      // metaSummary was not available (AI failed) — render the inline summary
      console.log(clr.cyan('  MARKET SUMMARY'));
      br();
      this.wrapText(state.marketSummary).forEach(l => console.log(`  ${clr.dim(l)}`));
      br();
    }

    const meaningful = state.thoughts.filter(t => t.length > 20);
    if (meaningful.length > 0) {
      console.log(clr.cyan('  AGENT REASONING CHAIN'));
      br();
      for (const t of meaningful.slice(0, 8)) {
        this.wrapText(t).forEach((l, i) =>
          console.log(`  ${i === 0 ? clr.cyan('[THOUGHT]') : ' '}  ${clr.dim(l)}`),
        );
        br();
      }
    }

    if (state.opportunities.length > 0) {
      console.log(clr.white('  OPPORTUNITIES'));
      for (const [idx, o] of state.opportunities.entries()) {
        const action  = (o.action ?? 'WATCH').toUpperCase() as 'BUY' | 'SELL' | 'WATCH';
        const aClr    = action === 'BUY' ? clr.green : action === 'SELL' ? clr.red : clr.yellow;
        const conf    = Number(o.confidence ?? 0);
        const confStr = conf >= 75 ? clr.green(conf + '%') : conf >= 50 ? clr.yellow(conf + '%') : clr.red(conf + '%');
        const spotStr = o.spot_price != null
          ? clr.dim(`  spot $${o.spot_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`)
          : '';
        const isLate  = String(o.late_signal).toUpperCase().startsWith('YES');

        br();
        console.log(`  ${clr.dim(String(idx + 1).padStart(2, '0'))}  [OPP] ${clr.white(o.asset)} ${clr.dim('[' + o.asset_type + ']')}  ${aClr(action)}  ${confStr}${spotStr}`);
        if (o.reasoning) this.wrapText(o.reasoning).forEach(l => console.log(`      ${clr.dim(l)}`));

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
        if (o.invalidation) this.wrapText(`invalidates if: ${o.invalidation}`).forEach(l => console.log(`      ${clr.dim(l)}`));
        if (o.risks)        this.wrapText(`risks: ${o.risks}`).forEach(l => console.log(`      ${clr.dim(l)}`));
      }
      br();
    } else {
      br();
      console.log(clr.yellow('  No high-conviction opportunities identified in this session.'));
      br();
    }

    if (state.contrarian.length > 0) {
      console.log(clr.magenta('  CONTRARIAN SIGNALS'));
      br();
      for (const s of state.contrarian) {
        this.wrapText(s).forEach((l, i) =>
          console.log(`  ${i === 0 ? clr.magenta('[CONTRARIAN]') : ' '}  ${l}`),
        );
        br();
      }
    }

    if (state.riskWarnings.length > 0) {
      console.log(clr.red('  RISK WARNINGS'));
      br();
      for (const r of state.riskWarnings) {
        this.wrapText(r).forEach((l, i) =>
          console.log(`  ${i === 0 ? clr.red('[RISK]') : ' '}  ${clr.red(l)}`),
        );
        br();
      }
    }

    if (state.recommendedActions.length > 0) {
      console.log(clr.green('  RECOMMENDED ACTIONS'));
      br();
      for (const a of state.recommendedActions) {
        this.wrapText(a).forEach((l, i) =>
          console.log(`  ${i === 0 ? clr.green('[ACTION]') : ' '}  ${l}`),
        );
        br();
      }
    }

    console.log(clr.dim(`  tools  ${[...new Set(state.toolsUsed)].join('  ')}`));
    console.log(clr.dim(`  assets ${Array.from(state.fetchedAssets).join(', ') || 'none'}`));
    br();
  }
}
