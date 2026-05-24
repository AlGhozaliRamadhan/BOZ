import axios from 'axios';
import { log, clr } from '../utils/logger.js';
import { yahooFinance } from '../services/market/yahoo.service.js';
import { newsFetchService, AllNewsData } from '../services/news/news.fetch.service.js';
import { resolveSymbol, LATE_KEYWORDS } from '../shared/market-constants.js';
import { BaseAgent, ParsedToolCall } from './base.agent.js';
import { sessionLogService } from '../services/core/session.log.service.js';


interface AgentOpportunity {
  asset: string;
  asset_type: string;
  action: 'BUY' | 'SELL' | 'WATCH';
  conviction: 'HIGH' | 'MEDIUM' | 'SPECULATIVE';  // calibrated conviction level
  confidence: number;
  reasoning: string;
  entry_range: string;
  target_range: string;
  stop_loss: string;
  invalidation: string;
  risks: string;
  spot_price?: number;
  late_signal: string;
  sources: string[];            // tool calls that ground this opportunity
}

interface AgentState {
  thoughts: string[];
  toolsUsed: string[];
  fetchedAssets: Set<string>;
  priceCache: Map<string, number>;    // asset → live price from fetch_price
  mentionedAssets: Set<string>;       // assets seen in news headlines
  momentumCache: Map<string, string>; // asset → 3-day momentum summary
  catalystsFound: string[];           // upcoming catalysts collected this session
  collectedNews: string[];
  opportunities: AgentOpportunity[];
  marketRegime: string;
  marketSummary: string;
  riskWarnings: string[];
  contrarian: string[];
  recommendedActions: string[];
  finished: boolean;
  previousSessionContext: string;     // retrospective from last session
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
          market_regime: { type: 'string', enum: ['RISK_ON', 'RISK_OFF', 'TRANSITION'] },
          market_summary: { type: 'string', description: '2-3 sentence synthesis of dominant cross-asset theme.' },
          key_themes: { type: 'array', items: { type: 'string' } },
          contrarian: { type: 'array', items: { type: 'string' } },
          risk_warnings: { type: 'array', items: { type: 'string' } },
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
                asset: { type: 'string' },
                asset_type: { type: 'string', enum: ['crypto', 'stock', 'commodity', 'forex', 'index'] },
                action: { type: 'string', enum: ['BUY', 'SELL', 'WATCH'] },
                confidence: { type: 'number', description: '0-100. >80 requires 3 independent confirming signals.' },
                reasoning: { type: 'string', description: 'Bull vs bear case. Be specific — cite the data.' },
                entry_range: { type: 'string', description: 'e.g. "from 64200 to 65800"' },
                target_range: { type: 'string' },
                stop_loss: { type: 'string' },
                invalidation: { type: 'string', description: 'The specific condition that would flip this thesis.' },
                risks: { type: 'string', description: 'Comma-separated list of 2-3 risks.' },
                late_signal: { type: 'string', enum: ['YES', 'NO'] },
                conviction: {
                  type: 'string',
                  enum: ['HIGH', 'MEDIUM', 'SPECULATIVE'],
                  description:
                    'HIGH = strong multi-signal confirmation. ' +
                    'MEDIUM = 1-2 confirming signals, acceptable risk. ' +
                    'SPECULATIVE = technical + macro align but missing confirmation — use lower confidence, WATCH or cautious BUY/SELL.',
                },
                sources: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'REQUIRED. Exact tool calls backing this setup — e.g. ' +
                    '["fetch_price:BTC","fetch_price_momentum:BTC","fetch_news:all","fetch_fear_greed"]. ' +
                    'Only list tools already called this session.',
                },
              },
              required: ['asset', 'asset_type', 'action', 'conviction', 'confidence', 'reasoning',
                'entry_range', 'target_range', 'stop_loss', 'invalidation', 'risks', 'late_signal', 'sources'],
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
      name: 'fetch_social_sentiment',
      description: 'Scan Reddit for real-time crowd velocity and social sentiment on a topic. ' +
        'Returns hot post titles, upvote momentum, and a bull/bear vote count from CryptoPanic. ' +
        'Use to detect crowd narrative shifts and breaking story velocity before they hit mainstream news.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'Asset or keyword to scan — e.g. "BTC", "gold", "macro", "stocks".',
          },
          segment: {
            type: 'string',
            enum: ['crypto', 'stocks', 'macro'],
            description: 'Market segment — determines which subreddits to scan.',
          },
        },
        required: ['topic', 'segment'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'scan_upcoming_catalysts',
      description: 'Scan the economic calendar and known crypto events for imminent catalysts in the next 24-72h. ' +
        'Returns high-impact scheduled events (CPI, FOMC, earnings, token unlocks, etc.). ' +
        'Call this to determine if any upcoming event could invalidate or supercharge a setup.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_price_momentum',
      description: 'Fetch 7-day OHLCV price history for an asset and compute short-term momentum: ' +
        '1d/3d/7d returns, trend direction, average volume vs current, and whether momentum is accelerating or fading. ' +
        'Use after fetch_price to add time-context to a price level.',
      parameters: {
        type: 'object',
        properties: {
          asset: { type: 'string', description: 'Asset name or ticker.' },
        },
        required: ['asset'],
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
          reason: { type: 'string' },
          next_actions: { type: 'array', items: { type: 'string' } },
        },
        required: ['reason', 'next_actions'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'audit_claims',
      description: 'MANDATORY before finish. Self-audit every emitted opportunity: verify price was fetched, confidence matches evidence, reasoning cites real data. Uncited opportunities are auto-downgraded. Call this immediately before finish.',
      parameters: {
        type: 'object',
        properties: {
          verified_opportunities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                asset:                { type: 'string' },
                price_fetched:        { type: 'boolean', description: 'Did you call fetch_price for this asset?' },
                evidence_count:       { type: 'number',  description: 'Number of independent data sources used.' },
                confidence_justified: { type: 'boolean', description: 'Does confidence % match evidence count per ANALYTICAL STANDARDS?' },
                corrections:          { type: 'string',  description: 'Changes made to fix this entry, or "none".' },
              },
              required: ['asset', 'price_fetched', 'evidence_count', 'confidence_justified', 'corrections'],
            },
          },
        },
        required: ['verified_opportunities'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish',
      description: 'End the analysis session. You MUST call audit_claims before this. Only valid after: (1) broad news fetch, (2) fear/greed check, (3) ≥2 asset price fetches, (4) summarize_findings recorded, (5) opportunities emitted, (6) audit_claims run.',
      parameters: {
        type: 'object',
        properties: {
          recommended_actions: { type: 'array', items: { type: 'string' } },
          final_thoughts: { type: 'string' },
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
      thoughts: [],
      toolsUsed: [],
      fetchedAssets: new Set(),
      priceCache: new Map(),
      mentionedAssets: new Set(),
      momentumCache: new Map(),
      catalystsFound: [],
      collectedNews: [],
      opportunities: [],
      marketRegime: 'TRANSITION',
      marketSummary: '',
      riskWarnings: [],
      contrarian: [],
      recommendedActions: [],
      finished: false,
      previousSessionContext: '',
    };

    const { iterations, elapsed } = await this.runLoop(
      state,
      (s: AgentState) => s.finished,
      (args, s: AgentState) => {
        s.finished = true;
        if (args.recommended_actions) s.recommendedActions = args.recommended_actions;
        if (args.final_thoughts) s.thoughts.push(args.final_thoughts);
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

    // Persist session so the next run can show a retrospective
    sessionLogService.saveSession({
      timestamp:     new Date().toISOString(),
      regime:        state.marketRegime,
      marketSummary: state.marketSummary,
      catalysts:     state.catalystsFound,
      toolCallCount: state.toolsUsed.length,
      opportunities: state.opportunities.map(o => ({
        asset: o.asset, action: o.action,
        conviction: o.conviction ?? 'MEDIUM',
        confidence: o.confidence,
        entry_range: o.entry_range, target_range: o.target_range,
        stop_loss: o.stop_loss, spot_price: o.spot_price,
      })),
    });
  }

  // ─── BaseAgent abstract implementations ─────────────────────────────────

  protected getToolDefinitions(): object[] {
    return TOOL_DEFINITIONS;
  }

  protected async executeTool(call: ParsedToolCall, state: AgentState): Promise<string> {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    let result: string;
    try {
      switch (call.name) {
        case 'fetch_news':              result = await this.toolFetchNews(call.arguments, state); break;
        case 'fetch_price':             result = await this.toolFetchPrice(call.arguments, state); break;
        case 'fetch_fear_greed':        result = await this.toolFetchFearGreed(state); break;
        case 'fetch_trending_crypto':   result = await this.toolFetchTrendingCrypto(state); break;
        case 'fetch_social_sentiment':  result = await this.toolFetchSocialSentiment(call.arguments, state); break;
        case 'scan_upcoming_catalysts': result = await this.toolScanUpcomingCatalysts(state); break;
        case 'fetch_price_momentum':    result = await this.toolFetchPriceMomentum(call.arguments, state); break;
        case 'search_news_by_asset':    result = this.toolSearchNewsByAsset(call.arguments, state); break;
        case 'summarize_findings':      result = this.toolSummarizeFindings(call.arguments, state); break;
        case 'emit_opportunities':      result = this.toolEmitOpportunities(call.arguments, state); break;
        case 'request_deeper_analysis': result = this.toolRequestDeeperAnalysis(call.arguments, state); break;
        case 'audit_claims':            result = this.toolAuditClaims(call.arguments, state); break;
        case 'finish':                  result = 'Analysis session marked as complete.'; break;
        default:                        result = `Unknown tool: ${call.name}`;
      }
    } catch (err: any) {
      result = `Tool error (${call.name}): ${err.message}`;
    }
    // Stamp timestamp + unfetched-assets reminder on all data tool results
    const dataTools = new Set(['fetch_news', 'fetch_price', 'fetch_fear_greed', 'fetch_trending_crypto',
      'search_news_by_asset', 'fetch_social_sentiment', 'fetch_price_momentum']);
    if (dataTools.has(call.name)) {
      result = `[DATA @ ${ts}]\n${result}${this.groundingReminder(state)}`;
    }
    return result;
  }

  /** Lists assets seen in news but not yet price-fetched, to prevent fabricated prices. */
  private groundingReminder(state: AgentState): string {
    const unfetched = [...state.mentionedAssets].filter(a => !state.fetchedAssets.has(a)).slice(0, 8);
    if (unfetched.length === 0) return '';
    return (
      `\n\n[GROUNDING] Price NOT fetched for: ${unfetched.join(', ')}` +
      `\nDo NOT reference prices for these assets without calling fetch_price first.`
    );
  }

  protected buildSystemPrompt(): string {
    return `You are an elite autonomous cross-asset macro research agent with access to real-time market tools.

You are NOT a chatbot that responds to commands. You are an independent thinker who decides your own investigation path, follows wherever the data leads, and concludes only when YOU are satisfied you have a complete, well-evidenced market picture.

─── YOUR NATURE ─────────────────────────────────────────────────────────────────

You reason freely. Between tool calls you think aloud — share your hypotheses, doubts, and the connections you are drawing. This thinking is visible to the user and is valued. Do not suppress it.

You follow evidence, not a script. If the news reveals an unexpected theme, pursue it. If a price level surprises you, investigate why. If two signals conflict, dig until you resolve the conflict — or honestly report the uncertainty.

You call finish only when YOU decide you are done. There is no rush, but you have a hard cap of 80 steps and 20 minutes, with a soft nudge at 15 minutes. Aim to conclude before the caps.

─── HOW TO THINK — MANDATORY REFLECTION PROTOCOL ────────────────────────────────

After EVERY tool result, before calling the next tool, write a reflection in your text content using this structure:

  RECEIVED: [one sentence — what did the data actually show?]
  EXPECTED: [was this what you anticipated? yes / no — and why?]
  CHANGES:  [how does this update your thesis for this asset or the overall regime?]
  NEXT:     [what specific question does this raise that you need to answer next?]

If a result contradicts your prior hypothesis, say so explicitly: "I was wrong about X because the data shows Y." Never soften uncertainty with vague hedging.

─── ANTI-FABRICATION RULES — MANDATORY ─────────────────────────────────────────

RULE 1 — NO PRICE WITHOUT fetch_price
  Never state, imply, or use a specific price for any asset you have not called
  fetch_price on. If unfetched, write "price unknown — must fetch" instead.
  Tool results will show a [GROUNDING] footer listing assets still unfetched.

RULE 2 — CONFIDENCE IS EVIDENCE-GATED
  >80% confidence → you MUST have fetch_price + 2 independent news/sentiment sources.
  65–80%           → minimum 1 fetch_price OR 2 distinct headlines.
  50–65%           → action MUST be WATCH, never BUY or SELL.
  <50%             → skip entirely.

RULE 3 — NO CAUSAL CLAIMS WITHOUT A SOURCE
  If you say "BTC fell because of X", X must appear in a news headline you received.
  If it does not, say "cause uncertain — no news source found".

RULE 4 — CONTRADICT EXPLICITLY
  If a tool result disproves something you said, write:
  "CORRECTION: I stated [X] but the data shows [Y]. Updating thesis."

RULE 5 — AUDIT BEFORE FINISH
  You MUST call audit_claims before calling finish. This is not optional.
  audit_claims will auto-downgrade any opportunity with price_fetched: false
  or unjustified confidence. Fix corrections before calling finish.

─── TOOLS ───────────────────────────────────────────────────────────────────────

• fetch_news              — broad sweep across crypto, stocks, macro, commodities, forex
• fetch_fear_greed        — crypto crowd sentiment 0-100 with 7-day trend
• fetch_trending_crypto   — what the crypto crowd is chasing right now
• fetch_price             — live price for any asset (crypto, stock, commodity, forex, index)
• fetch_price_momentum    — 7-day OHLCV history: 1d/3d/7d returns, trend, volume momentum
• fetch_social_sentiment  — Reddit velocity + CryptoPanic bull/bear votes for a topic
• scan_upcoming_catalysts — economic calendar (CPI, FOMC) + crypto events next 24-72h
• search_news_by_asset    — filter fetched news for a specific asset or keyword
• summarize_findings      — checkpoint your regime assessment and key themes
• emit_opportunities      — record a specific trade setup with full parameters
• request_deeper_analysis — flag a divergence you want to investigate further
• audit_claims            — MANDATORY self-audit before finish; auto-corrects bad confidence
• finish                  — end the session (only after audit_claims)

─── ANALYTICAL STANDARDS ────────────────────────────────────────────────────────

PROPAGATION — trace the full causal chain:  first-order → second-order → third-order effects.
CONFIDENCE:  >80% = cite 3 independent signals.  65-80% = 2 signals.  50-65% = WATCH only.  <50% = skip.
LATE ENTRY:  if parabolic or near 52-week high → late_signal YES, action WATCH.
CROWD:       Fear & Greed >75 → fade longs.  <25 → fade shorts.
INVALIDATION: every BUY/SELL must name a specific price level or event that disproves the thesis.

CONVICTION LEVELS (required on every emit_opportunities call):
  HIGH        — 3+ independent signals align. BUY/SELL allowed at confidence >70.
  MEDIUM      — 2 signals align. BUY/SELL allowed at confidence 55-70.
  SPECULATIVE — Technical + macro align but confirmation missing. Use confidence 40-55, prefer WATCH.
               Still emit — a speculative call with clear invalidation is more useful than silence.

CATALYST AWARENESS: Call scan_upcoming_catalysts early. A setup backed by a catalyst = +20% conviction.
A setup running INTO a risk event should be noted "hold until post-event".

MOMENTUM CONTEXT: Call fetch_price_momentum after fetch_price for any BUY/SELL candidate.
Fading momentum + falling news velocity = signal exhaustion. Accelerating momentum + social buzz = booster.`;
  }

  protected buildInitialPrompt(): string {
    const date = new Date().toISOString().split('T')[0];
    const lastSession = sessionLogService.getLastSession();
    const retro = lastSession ? sessionLogService.buildRetrospectiveContext(lastSession) : '';
    return [
      `Today is ${date}. Begin your autonomous market analysis.`,
      retro,
      `Start with scan_upcoming_catalysts (anchor to macro calendar), then fetch_news (broad context),`,
      `then fetch_fear_greed (crowd sentiment). For each BUY/SELL candidate call fetch_price then`,
      `fetch_price_momentum. Use fetch_social_sentiment to detect narrative velocity shifts.`,
      `Emit speculative setups too — label conviction SPECULATIVE with clear invalidation.`,
      `Goal: 3-7 setups across conviction levels. Call audit_claims then finish when done.`,
    ].filter(Boolean).join('\n');
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
    const all = data.all;
    const high = all.filter(n => n.impact === 'high').slice(0, 10);
    const med = all.filter(n => n.impact === 'medium').slice(0, 8);

    const lines: string[] = [
      `TOTAL NEWS ITEMS: ${all.length}`,
      `  crypto: ${data.cryptocurrency.length}  |  stocks: ${data.stocks.length}  |  economy: ${data.economy.length}  |  commodities: ${data.commodities.length}  |  oil: ${data.oil.length}  |  forex: ${data.forex.length}`,
      '',
      '── HIGH IMPACT ─────────────────────────────────',
    ];

    for (const n of high) {
      const assets = (n.assets ?? []).join(', ');
      lines.push(`[${n.category.toUpperCase()}] ${n.title}`);
      if (assets) lines.push(`  assets: ${assets}`);
      if (n.sentiment) lines.push(`  sentiment: ${n.sentiment}`);
    }

    lines.push('', '── MEDIUM IMPACT ────────────────────────────────');
    for (const n of med) lines.push(`[${n.category.toUpperCase()}] ${n.title}`);

    // Cache flat news strings for search_news_by_asset
    state.collectedNews = all.map(n => `[${n.category}] [${n.impact}] ${n.title} ${n.details ?? ''}`);

    // Populate mentionedAssets so groundingReminder can track what still needs a price fetch
    for (const n of all) {
      for (const a of (n.assets ?? [])) {
        state.mentionedAssets.add(a.trim().toUpperCase());
      }
    }
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
      const quote = await yahooFinance.quote(symbol);
      const price = (quote as any).regularMarketPrice;
      const change = (quote as any).regularMarketChangePercent;
      const high52 = (quote as any).fiftyTwoWeekHigh;
      const low52 = (quote as any).fiftyTwoWeekLow;
      const name = (quote as any).longName ?? (quote as any).shortName ?? symbol;

      const lines = [
        `LIVE PRICE: ${name} (${symbol})`,
        `  price:    $${price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
        `  24h chg:  ${change != null ? (change > 0 ? '+' : '') + change.toFixed(2) + '%' : 'n/a'}`,
        `  52w high: ${high52 != null ? '$' + high52.toLocaleString() : 'n/a'}`,
        `  52w low:  ${low52 != null ? '$' + low52.toLocaleString() : 'n/a'}`,
      ];

      // Store in priceCache so emit_opportunities can auto-fill spot_price
      if (price != null) {
        state.priceCache.set(asset.trim().toUpperCase(), price);
        state.priceCache.set(symbol.toUpperCase(), price);
      }

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

  private async toolFetchFearGreed(state: AgentState): Promise<string> {
    state.toolsUsed.push('fetch_fear_greed');
    try {
      const res = await axios.get(
        'https://api.alternative.me/fng/?limit=7',
        { headers: this.headers, timeout: 5000 },
      );
      const data = res.data?.data ?? [];
      if (data.length === 0) return 'Fear & Greed data unavailable.';

      const latest = data[0];
      const values: number[] = data.map((d: any) => parseInt(d.value ?? '50', 10));
      const avg7d = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
      const current = parseInt(latest.value, 10);
      const label = latest.value_classification ?? 'Unknown';
      const momentum =
        values[0] > parseFloat(avg7d) + 5 ? 'RISING_GREED' :
          values[0] < parseFloat(avg7d) - 5 ? 'RISING_FEAR' : 'STABLE';

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
      try {
        const res = await axios.get(
          'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
          { headers: this.headers, timeout: 5000 },
        );
        const score = res.data?.fear_and_greed?.score;
        const rating = res.data?.fear_and_greed?.rating;
        return `FEAR & GREED (CNN fallback)\n  score: ${Math.round(score)}/100 (${rating})\n  7d trend: unavailable`;
      } catch {
        return 'Fear & Greed data unavailable from both sources.';
      }
    }
  }

  private async toolFetchTrendingCrypto(state: AgentState): Promise<string> {
    state.toolsUsed.push('fetch_trending_crypto');
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
    const limit = args.limit ?? 10;
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
    state.toolsUsed.push('search_news_by_asset');
    return result.join('\n');
  }

  private toolSummarizeFindings(args: any, state: AgentState): string {
    state.marketRegime = args.market_regime ?? state.marketRegime;
    state.marketSummary = args.market_summary ?? state.marketSummary;
    if (Array.isArray(args.key_themes)) state.thoughts.push(...args.key_themes);
    if (Array.isArray(args.contrarian)) state.contrarian.push(...args.contrarian);
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
    const requiredSessionTools = ['scan_upcoming_catalysts', 'fetch_news', 'fetch_fear_greed'];
    const missingSessionTools = requiredSessionTools.filter(t => !state.toolsUsed.includes(t));
    if (missingSessionTools.length > 0) {
      return `[BLOCKED] emit_opportunities requires these tools first: ${missingSessionTools.join(', ')}.`;
    }

    const opps: any[] = Array.isArray(args.opportunities) ? args.opportunities : [];
    if (opps.length === 0) return 'No opportunities provided.';

    const added: string[] = [];
    const blocked: string[] = [];

    for (const o of opps) {
      const asset     = String(o.asset ?? '').toUpperCase();
      const action    = String(o.action ?? 'WATCH').toUpperCase() as 'BUY' | 'SELL' | 'WATCH';
      const sources   = Array.isArray(o.sources) ? o.sources.map((s: unknown) => String(s).trim()).filter(Boolean) as string[] : [];

      if (sources.length === 0) {
        blocked.push(`[BLOCKED] ${asset}: sources[] is required and must cite the tool calls used.`);
        continue;
      }

      const invalidSources = sources.filter(s => !state.toolsUsed.includes(s.split(':')[0] ?? s));
      if (invalidSources.length > 0) {
        blocked.push(`[BLOCKED] ${asset}: sources contain tools not called this session: ${invalidSources.join(', ')}`);
        continue;
      }

      const hasFetchPrice = sources.some(s => s.toLowerCase().startsWith('fetch_price'));
      const hasMomentum  = sources.some(s => s.toLowerCase().startsWith('fetch_price_momentum'));
      const hasPriceCached = state.fetchedAssets.has(asset) || state.priceCache.has(asset);
      const hasMomentumCached = state.momentumCache.has(asset);

      // Require price + momentum coverage before accepting an opportunity
      let effectiveAction = action;
      let effectiveConf   = Number(o.confidence ?? 50);

      if (!hasFetchPrice || !hasPriceCached) {
        blocked.push(`[BLOCKED] ${asset}: fetch_price is required before emit_opportunities.`);
        continue;
      }

      if (!hasMomentum || !hasMomentumCached) {
        blocked.push(`[BLOCKED] ${asset}: fetch_price_momentum is required before emit_opportunities.`);
        continue;
      }

      // Auto-fill spot_price from priceCache
      const cachedPrice = state.priceCache.get(asset) ?? state.priceCache.get(String(o.asset ?? ''));

      const opp: AgentOpportunity = {
        asset,
        asset_type:   String(o.asset_type ?? 'unknown'),
        action:       effectiveAction,
        conviction:   (['HIGH', 'MEDIUM', 'SPECULATIVE'].includes(String(o.conviction ?? '').toUpperCase())
          ? String(o.conviction).toUpperCase()
          : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'SPECULATIVE',
        confidence:   effectiveConf,
        reasoning:    String(o.reasoning ?? ''),
        entry_range:  String(o.entry_range ?? ''),
        target_range: String(o.target_range ?? ''),
        stop_loss:    String(o.stop_loss ?? ''),
        invalidation: String(o.invalidation ?? ''),
        risks:        String(o.risks ?? ''),
        late_signal:  String(o.late_signal ?? 'NO'),
        sources: [...new Set(sources)],
        spot_price:   cachedPrice,
      };
      state.opportunities.push(opp);
      added.push(`${opp.action} ${opp.asset} (confidence: ${opp.confidence}%)`);
      log.info('agent', `  + opportunity: ${opp.action} ${opp.asset} @ ${opp.confidence}%`);
    }

    const out = [`[OK] Recorded ${added.length} opportunity/ies:`, ...added.map(a => '  - ' + a)];
    if (blocked.length) out.push('', ...blocked);
    return out.join('\n');
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

  private toolAuditClaims(args: any, state: AgentState): string {
    const checks: any[] = Array.isArray(args.verified_opportunities) ? args.verified_opportunities : [];
    if (checks.length === 0) return '[AUDIT] No opportunities to verify.';

    const lines: string[] = ['[AUDIT] Self-audit results:'];
    let corrections = 0;

    for (const check of checks) {
      const asset  = String(check.asset ?? '').toUpperCase();
      const opp    = state.opportunities.find(o => o.asset.toUpperCase() === asset);
      if (!opp) { lines.push(`  ${asset}: not found in emitted opportunities — skipped.`); continue; }

      const correctionText = String(check.corrections ?? 'none');
      const priceFetched   = Boolean(check.price_fetched);
      const confJustified  = Boolean(check.confidence_justified);
      const issues: string[] = [];

      // Auto-downgrade if price never fetched
      if (!priceFetched && opp.action !== 'WATCH') {
        const old = opp.confidence;
        opp.action     = 'WATCH';
        opp.confidence = Math.min(opp.confidence, 55);
        issues.push(`price not fetched — downgraded to WATCH, confidence ${old}% → ${opp.confidence}%`);
        corrections++;
      }

      // Auto-downgrade if confidence unjustified
      if (!confJustified && opp.confidence > 65) {
        const old = opp.confidence;
        opp.confidence = Math.min(opp.confidence - 15, 65);
        issues.push(`confidence unjustified — reduced ${old}% → ${opp.confidence}%`);
        corrections++;
      }

      const status = issues.length ? '[CORRECTED]' : '[OK]';
      lines.push(`  ${status} ${opp.asset} — ${issues.length ? issues.join('; ') : 'passed all checks'}`);
      if (correctionText !== 'none') lines.push(`    agent notes: ${correctionText}`);
      log.info('agent', `  audit ${asset}: ${status}`);
    }

    lines.push('');
    lines.push(corrections > 0
      ? `[AUDIT] ${corrections} correction(s) applied. Review and call finish when ready.`
      : '[AUDIT] All opportunities passed. You may now call finish.');
    return lines.join('\n');
  }

  // ─── New tools: social sentiment, catalysts, price momentum ──────────────

  private async toolFetchSocialSentiment(args: any, state: AgentState): Promise<string> {
    const topic   = String(args.topic ?? 'crypto').toLowerCase();
    const segment = String(args.segment ?? 'crypto');
    const lines: string[] = [`SOCIAL SENTIMENT: ${topic.toUpperCase()} (${segment})`];

    // Pick subreddits based on segment
    const subreddits: Record<string, string[]> = {
      crypto:  ['CryptoCurrency', 'Bitcoin'],
      stocks:  ['wallstreetbets', 'stocks'],
      macro:   ['Economics', 'investing'],
    };
    const subs = subreddits[segment] ?? subreddits.crypto;

    for (const sub of subs) {
      try {
        const res = await axios.get(
          `https://www.reddit.com/r/${sub}/hot.json?limit=15`,
          { headers: this.headers, timeout: 6000 },
        );
        const posts: any[] = (res.data?.data?.children ?? []).map((c: any) => c.data);
        const relevant = posts.filter(p =>
          p.title.toLowerCase().includes(topic) ||
          topic === 'crypto' || topic === 'macro',
        ).slice(0, 5);

        if (relevant.length === 0) { lines.push(`  r/${sub}: no relevant posts`); continue; }

        // Velocity: posts created in last 1h
        const now = Date.now() / 1000;
        const fresh = posts.filter(p => (now - p.created_utc) < 3600).length;
        lines.push(`\n  r/${sub} — velocity: ${fresh} posts in last 1h (of ${posts.length} hot)`);

        let bullCount = 0, bearCount = 0;
        for (const p of relevant) {
          const title = p.title.slice(0, 100);
          const heat  = p.ups > 2000 ? '[VIRAL]' : p.ups > 500 ? '[HOT]' : '[NORM]';
          // Naive sentiment from title keywords
          const lc = title.toLowerCase();
          const isBull = /bull|pump|moon|surge|soar|break|ath|buy/i.test(lc);
          const isBear = /bear|crash|dump|fall|drop|short|fear|liquidat/i.test(lc);
          if (isBull) bullCount++; else if (isBear) bearCount++;
          lines.push(`    ${heat} ${title}  (↑${p.ups} 💬${p.num_comments})`);
        }
        lines.push(`    Sentiment scan: ${bullCount} bullish / ${bearCount} bearish of top ${relevant.length}`);
      } catch { lines.push(`  r/${sub}: unavailable`); }
    }

    state.toolsUsed.push('fetch_social_sentiment');
    return lines.join('\n');
  }

  private async toolScanUpcomingCatalysts(state: AgentState): Promise<string> {
    const lines: string[] = ['UPCOMING CATALYSTS (next 72h)'];

    // ── Economic calendar via Forex Factory JSON ────────────────────────────
    try {
      const res = await axios.get(
        'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
        { headers: this.headers, timeout: 7000 },
      );
      const events: any[] = res.data ?? [];
      const now = new Date();
      const cutoff = new Date(now.getTime() + 72 * 3600 * 1000);

      const high = events.filter(e => {
        const d = new Date(e.date ?? '');
        return e.impact === 'High' && d >= now && d <= cutoff;
      });

      if (high.length === 0) {
        lines.push('  No high-impact macro events in next 72h.');
      } else {
        lines.push('  HIGH-IMPACT MACRO:');
        for (const e of high.slice(0, 8)) {
          const dt = new Date(e.date).toUTCString().slice(0, 22);
          lines.push(`    [${dt}] ${e.country} — ${e.title}`);
          if (e.forecast)  lines.push(`      forecast: ${e.forecast}  prev: ${e.previous ?? 'n/a'}`);
          state.catalystsFound.push(`${e.country} ${e.title} @ ${dt}`);
        }
      }
    } catch { lines.push('  Economic calendar: unavailable (Forex Factory)'); }

    // ── Known crypto recurring events ───────────────────────────────────────
    const now    = new Date();
    const dow    = now.getUTCDay(); // 0=Sun
    const hour   = now.getUTCHours();
    const crypto: string[] = [];

    if (dow === 5 && hour < 16)  crypto.push('CME BTC/ETH futures weekly expiry today (Fri 16:00 UTC)');
    if (dow === 6)                crypto.push('CME futures closed — weekend liquidity thin');
    if (hour < 14 && hour > 9)   crypto.push('US pre-market window: watch for gap fills and momentum');

    // Last Friday of month = CME monthly expiry (approximate check)
    const nextFri = new Date(now);
    nextFri.setDate(now.getDate() + ((5 - now.getUTCDay() + 7) % 7 || 7));
    const daysToFri = Math.round((nextFri.getTime() - now.getTime()) / 86400000);
    if (daysToFri <= 2) crypto.push(`CME monthly expiry approaching (~${daysToFri}d) — expect elevated IV`);

    if (crypto.length) {
      lines.push('\n  CRYPTO RECURRING:');
      crypto.forEach(c => { lines.push(`    • ${c}`); state.catalystsFound.push(c); });
    }

    lines.push('\n[NOTE] Run scan_upcoming_catalysts early. Setups running INTO high-impact events');
    lines.push('       should be labelled "hold until post-event" to avoid catalyst risk.');

    state.toolsUsed.push('scan_upcoming_catalysts');
    return lines.join('\n');
  }

  private async toolFetchPriceMomentum(args: any, state: AgentState): Promise<string> {
    const asset  = String(args.asset ?? '');
    if (!asset) return 'Error: asset argument required.';
    const symbol = resolveSymbol(asset);
    if (!symbol) return `Cannot resolve "${asset}" to a known ticker.`;

    try {
      // Yahoo Finance public chart API — no auth required
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=7d`;
      const res  = await axios.get(url, { headers: this.headers, timeout: 8000 });
      const ts: number[] = res.data?.chart?.result?.[0]?.timestamp ?? [];
      const closes: (number | null)[] = res.data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const volumes: (number | null)[] = res.data?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume ?? [];

      const valid = closes.filter((c): c is number => c != null);
      if (valid.length < 2) return `Momentum data unavailable for ${asset}.`;

      const latest  = valid[valid.length - 1];
      const prev1d  = valid[valid.length - 2];
      const prev3d  = valid[Math.max(0, valid.length - 4)];
      const prev7d  = valid[0];

      const chg1d = ((latest - prev1d) / prev1d * 100).toFixed(2);
      const chg3d = ((latest - prev3d) / prev3d * 100).toFixed(2);
      const chg7d = ((latest - prev7d) / prev7d * 100).toFixed(2);

      const validVols = volumes.filter((v): v is number => v != null);
      const avgVol  = validVols.length ? Math.round(validVols.reduce((a, b) => a + b, 0) / validVols.length) : 0;
      const lastVol = validVols[validVols.length - 1] ?? 0;
      const volRatio = avgVol > 0 ? (lastVol / avgVol).toFixed(2) : 'n/a';

      // Determine trend
      const trend = Number(chg3d) > 2 ? 'UPTREND' : Number(chg3d) < -2 ? 'DOWNTREND' : 'SIDEWAYS';
      // Momentum acceleration: is 1d move bigger than avg daily 3d move?
      const avgDaily3d = Math.abs(Number(chg3d)) / 3;
      const accel = Math.abs(Number(chg1d)) > avgDaily3d ? 'ACCELERATING' : 'FADING';

      const momentum = `${trend} + ${accel}`;
      state.momentumCache.set(asset.toUpperCase(), momentum);
      state.momentumCache.set(symbol.toUpperCase(), momentum);
      state.toolsUsed.push('fetch_price_momentum');

      return [
        `PRICE MOMENTUM: ${asset.toUpperCase()} (${symbol}) — last 7 days`,
        `  current:   $${latest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
        `  1d change: ${Number(chg1d) >= 0 ? '+' : ''}${chg1d}%`,
        `  3d change: ${Number(chg3d) >= 0 ? '+' : ''}${chg3d}%`,
        `  7d change: ${Number(chg7d) >= 0 ? '+' : ''}${chg7d}%`,
        `  volume:    ${lastVol.toLocaleString()} (${volRatio}x avg)`,
        `  trend:     ${trend}`,
        `  momentum:  ${accel}`,
        ``,
        `MOMENTUM SIGNAL: ${momentum}`,
        Number(chg1d) > 5  ? `[WARNING] 1-day move >5% — possible overextension or breakout.` :
        Number(chg1d) < -5 ? `[WARNING] 1-day drop >5% — possible capitulation or breakdown.` : '',
        accel === 'FADING' && trend !== 'SIDEWAYS'
          ? `[CAUTION] Momentum fading inside a ${trend} — watch for reversal.` : '',
      ].filter(l => l !== '').join('\n');

    } catch (err: any) {
      return `Momentum fetch failed for ${asset}: ${err.message}`;
    }
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
        state.riskWarnings.length ? `OPEN UNCERTAINTIES\n${state.riskWarnings.join('\n')}` : '',
        state.contrarian.length ? `CONTRARIAN TAKE\n${state.contrarian.join('\n')}` : '',
      ].filter(Boolean).join('\n\n');
      return fallback || '';
    }
  }

  // ─── Final renderer ───────────────────────────────────────────────────────

  private renderFinalOutput(
    state: AgentState,
    elapsed: string,
    metaSummary: string,
  ): void {
    const W = 78;
    const light = clr.dim('─'.repeat(W));
    const br = () => console.log('');

    br();
    console.log(clr.magenta('  [AGENT] FINAL ANALYSIS'));
    console.log(clr.dim(`  ${elapsed}s · ${state.toolsUsed.length} tool calls · ${state.opportunities.length} opportunities`));
    br();

    const regime = (state.marketRegime ?? 'UNKNOWN').toUpperCase();
    const rClr = regime.includes('RISK_ON') ? clr.green : regime.includes('RISK_OFF') ? clr.red : clr.yellow;
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
        const action = (o.action ?? 'WATCH').toUpperCase() as 'BUY' | 'SELL' | 'WATCH';
        const aClr = action === 'BUY' ? clr.green : action === 'SELL' ? clr.red : clr.yellow;
        const conf = Number(o.confidence ?? 0);
        const confStr = conf >= 75 ? clr.green(conf + '%') : conf >= 50 ? clr.yellow(conf + '%') : clr.red(conf + '%');
        const spotStr = o.spot_price != null
          ? clr.dim(`  spot $${o.spot_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`)
          : '';
        const isLate = String(o.late_signal).toUpperCase().startsWith('YES');

        const conviction = (o.conviction ?? 'MEDIUM').toUpperCase();
        const cvClr = conviction === 'HIGH' ? clr.green : conviction === 'SPECULATIVE' ? clr.magenta : clr.yellow;

        br();
        console.log(`  ${clr.dim(String(idx + 1).padStart(2, '0'))}  [OPP] ${clr.white(o.asset)} ${clr.dim('[' + o.asset_type + ']')}  ${aClr(action)}  ${confStr}  ${cvClr('[' + conviction + ']')}${spotStr}`);
        if (o.reasoning) this.wrapText(o.reasoning).forEach(l => console.log(`      ${clr.dim(l)}`));

        const levels = [
          o.entry_range ? `entry  ${o.entry_range}` : '',
          o.target_range ? `target ${o.target_range}` : '',
          o.stop_loss ? `stop   ${o.stop_loss}` : '',
        ].filter(Boolean);
        if (levels.length) console.log(`      ${clr.dim(levels.join('   '))}`);

        if (o.late_signal) {
          const lClr = isLate ? clr.red : clr.green;
          console.log(`      ${clr.dim('[LATE]')}    ${lClr(o.late_signal)}`);
        }
        if (o.invalidation) this.wrapText(`invalidates if: ${o.invalidation}`).forEach(l => console.log(`      ${clr.dim(l)}`));
        if (o.risks) this.wrapText(`risks: ${o.risks}`).forEach(l => console.log(`      ${clr.dim(l)}`));
        if (o.sources && o.sources.length > 0) {
          this.wrapText(`sources: ${o.sources.join(' · ')}`).forEach(l => console.log(`      ${clr.dim(l)}`));
        }
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
