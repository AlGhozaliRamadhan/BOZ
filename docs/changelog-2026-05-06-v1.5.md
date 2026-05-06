# Changelog — v1.5 (2026-05-06)

## New Features

### News Intel Analyzer — Full Implementation
- **File:** `src/analyzers/news.intel.analyzer.ts`, `src/cli/cli.ts`
- Ported and significantly expanded the `NewsIntelligence` Python implementation into a fully modular TypeScript class (`NewsIntelAnalyzer`).

#### Data Sources — 7 independent feeds across 6 asset classes
- **CoinGecko Trending:** Top trending coins by search score with market cap rank.
- **CryptoCompare News:** Aggregates up to 15 recent crypto articles; high/medium/low impact scored against keyword lists (`regulation`, `etf`, `hack`, `surge`, `fed`, etc.).
- **Alpha Vantage** *(optional, requires `ALPHA_VANTAGE_API_KEY`)*: Sentiment-labelled stock news with per-ticker sentiment scores.
- **Finnhub** *(optional, requires `FINNHUB_API_KEY`)*: General market news with macro keyword detection.
- **FRED** *(optional, requires `FRED_API_KEY`)*: Federal Reserve economic data releases tagged as `economic_release` with `HIGH` impact.
- **RSS Broad Market:** Five feed categories — `stocks`, `commodities`, `oil`, `forex`, `economy` — each backed by two URL sources, parsed with `rss-parser`.
- **Crowd Sentiment:** Three-source composite:
  - `alternative.me` Fear & Greed (7-day trend + momentum direction `RISING_GREED / RISING_FEAR / STABLE`).
  - CNN Fear & Greed as fallback if `alternative.me` is unreachable.
  - CoinGecko top-10 market cap coins: live 24h price change, bull/bear breakdown.
  - StockTwits trending symbols (top 15, top-5 surfaced in prompt).

#### Asset Class Coverage in Output
- `crypto` · `stocks` · `economy` · `commodities` · `oil` · `forex`
- All items merged into a unified `all[]` array, priority-sorted by `impact` (`high → medium → low`) before being sent to AI.

#### Caching Layer
- Per-source TTL cache (in-memory, keyed by source name): crypto news 5 min, stock news 5 min, macro 10 min, broad market RSS 5 min, crowd sentiment 10 min.
- Cache hits logged at `[info] cache HIT <key>`; misses trigger a fresh fetch transparently.

#### Symbol Map & Live Price Enrichment
- `SYMBOL_MAP` resolves 60+ asset name variants to Yahoo Finance tickers (indices, forex pairs, bonds, commodities, crypto, mega-cap stocks).
- After AI response is parsed, every opportunity has its `spot_price` filled by a live `yahooFinance.quote()` call.
- Trade levels (`entry_range`, `target_range`, `stop_loss`) are auto-computed from spot price when the AI leaves them blank, using confidence-scaled percentage bands.

#### Late-Entry Detection
- `LATE_KEYWORDS` list (`already surged`, `record high`, `all-time high`, `parabolic`, `blew past`, etc.) scanned against news blobs per opportunity.
- If a late keyword matches, the opportunity's `action` is forced to `WATCH` regardless of AI output, and a `late_signal: YES — momentum looks extended` warning is appended.

#### AI System Prompt — Elite Macro Strategist Persona
- 25-year hedge fund strategist framing with explicit **multi-layer propagation** framework (first-order → second-order → third-order effects).
- **Bias elimination checklist** embedded in prompt (7 mandatory self-checks before each conclusion).
- **Crowd sentiment rules** hard-coded: Fear & Greed thresholds mapped to trading posture; crowd consensus at extremes treated as a **reversal warning**, not a tailwind.
- **Signal quality standards**: confidence > 80% requires 3 independent confirming signals; confidence < 50% must not appear as an opportunity.
- **Invalidation requirement**: every BUY/SELL must include a specific price level or event that would flip the thesis — vague invalidations explicitly rejected.
- Chain-of-thought stripping: if the model response contains `</think>` (DeepSeek / reasoning models), the reasoning block is separated, stored in `ai_reasoning_chain`, and rendered in its own section.

#### Six-Stage Structured AI Prompt
1. `STAGE 1 — REGIME`: RISK_ON / RISK_OFF / TRANSITION with ≥ 2 data-point citations.
2. `STAGE 2 — PROPAGATION MAP`: Full 1st → 2nd → 3rd order effect chain for top 3–5 events.
3. `STAGE 3 — CONSENSUS vs SURPRISE`: What is already priced in vs. what could catch the market off-guard.
4. `STAGE 4 — CROWD ANALYSIS`: Explicit crowd sentiment rules applied; extremes flagged as fade signals.
5. `STAGE 5 — TIMING`: Fresh move or already extended — explicit ruling per opportunity.
6. `STAGE 6 — CONVICTION RANKING`: Confidence assigned per signal quality standards.

#### Parsed Output Sections
- `MARKET_REGIME` · `MARKET_SUMMARY` · `SENTIMENT`
- `CROSS_ASSET_THEMES` (propagation chains)
- `EVENTS` (up to 8, pipe-delimited: event | assets | direction | impact | horizon | reasoning | second-order)
- `OPPORTUNITIES` (4–7, pipe-delimited: asset | type | action | confidence | reasoning | entry | target | stop | late | invalidation | risks)
- `CONTRARIAN_SIGNALS` · `RISK_WARNINGS` · `RECOMMENDED_ACTIONS`

#### Fallback Parser
- If structured parsing yields no output, a keyword-based fallback scans raw AI text and all news items for bullish/bearish signal counts, infers a `RISK_ON / RISK_OFF / NEUTRAL` sentiment, and surfaces the top 3 mentioned assets as `WATCH` opportunities.
- Fallback output is clearly marked with `warning: Parser fell back to keyword extraction`.

#### Risk Warning Auto-Generation
- When the AI response provides no `RISK_WARNINGS`, the system scans all news blobs with regex patterns for regulatory language, hack/exploit mentions, crash language, late-move indicators, and macro event dates — generating up to 4 specific contextual warnings automatically.

#### Terminal Renderer
- Full ANSI colour rendering with `wrapText()` for word-wrapped paragraphs at 90-character width.
- Opportunity cards display: asset, type badge, action colour (`green BUY / red SELL / yellow WATCH`), confidence with traffic-light colouring, live spot price, computed trade levels, late-entry flag, invalidation condition, and risks.
- AI reasoning chain rendered in its own collapsible section (first 600 chars) when present.

### Agentic News Intel — Beta (EXPERIMENTAL)
- **File:** `src/analyzers/news.intel.agent.ts`, `src/cli/cli.ts`
- Autonomous multi-iteration agentic analyzer using OpenAI function-calling (or offline JSON fallback).
- **Workflow:** Agent orchestrates its own research loop: fetches broad news → checks crowd sentiment → deep-dives on key assets → emits opportunities → validates cross-asset propagation chains.
- **Tools Available to Agent:** `fetch_news`, `fetch_price`, `fetch_fear_greed`, `fetch_trending_crypto`, `search_news_by_asset`, `summarize_findings`, `emit_opportunities`, `request_deeper_analysis`, `finish`.
- **Free-Running Reasoning Loop:** The agent explores data, reasons aloud with [THOUGHT] logs, and autonomously determines its own path to completion without arbitrary step limits.
- **Confidence Standards:** > 80% requires 3 independent signals; 65–80% requires 2 signals with directional bias; < 50% excluded.
- **Late-Entry Detection:** Scans news text against `LATE_KEYWORDS` and auto-downgrades extended moves to WATCH.
- **Max 50 iterations** hard cap to prevent runaway loops, though the agent typically finishes much sooner; full agent state tracked (iteration count, tools used, assets fetched, thoughts, opportunities, warnings, contrarian signals).
- **Output Rendering:** Clean, emoji-free ANSI render using bracketed headers (e.g. `[AGENT]`, `[ACTION]`, `[OBS]`) with regime colour, market summary, agent reasoning chain, opportunities with live prices, contrarian signals, risk warnings, and recommended actions.
- **AI Provider Support:** Native tool-calling on GitHub Models & NVIDIA; offline/Ollama uses JSON-in-text simulation.
- **Status:** Experimental. Agentic autonomy is novel; output quality depends on model capability and real-time data freshness.

### Improved CLI `/run` Command — Hierarchical Mode Picker
- **File:** `src/cli/cli.ts`
- `/run` now presents a three-option picker: `NVDA Market`, `News Intel Analyzer`, `News Intel Agent`.
- **NVDA Market** path: branches to `Intraday (2–6 h)` or `Long-term (3–12 mo)`.
- **News Intel Analyzer**: legacy deterministic analyzer.
- **News Intel Agent**: new agentic beta analyzer.
- Mode selection is colour-coded in confirmation output: NVDA green, News Intel Analyzer yellow, News Intel Agent yellow.

## Bug Fixes

### CryptoCompare `slice is not a function` crash
- **File:** `src/analyzers/news.intel.analyzer.ts`
- CryptoCompare returns `{ Data: {} }` (an object) on rate-limit or error responses. The prior code used `(res.data?.Data ?? []).slice(0, 15)`, which passes an object through the `??` operator and then crashes on `.slice()` because objects are not arrays.
- **Fix:** Replaced with `Array.isArray(res.data?.Data) ? res.data.Data : []` before calling `.slice()`.

### RSS commodities feed returning 404
- **File:** `src/analyzers/news.intel.analyzer.ts`
- `https://www.investing.com/rss/news_11.rss` is no longer served.
- **Fix:** Replaced with `https://feeds.feedburner.com/CommodityHQ`.

### RSS economy feed returning 404
- **File:** `src/analyzers/news.intel.analyzer.ts`
- `https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best` is dead.
- **Fix:** Replaced with `https://feeds.reuters.com/reuters/businessNews`.

## Internal / Under-the-Hood

### Dependency Enhancements
- **File:** `package.json`
- Added `rss-parser` for native RSS/Atom XML ingestion from financial news endpoints.
- `axios` used throughout `NewsIntelAnalyzer` for all REST API calls with per-request 5-second timeouts.
- `openai` SDK used for NVIDIA NIM provider path within the news analyzer (same SDK instance as `ai.service.ts`).

### Architecture Notes
- `NewsIntelAnalyzer` is a self-contained class with no shared mutable state — safe to instantiate per-run.
- All provider branches (GitHub Models via axios, NVIDIA NIM via OpenAI SDK, Ollama via local endpoint) are handled within the analyzer, consistent with how `ai.service.ts` handles provider routing elsewhere.
- Logging uses the centralised `log` / `clr` utilities from `utils/logger.ts` throughout (`log.info`, `log.warn`, `log.ok`, `log.ai`, `log.error`).
