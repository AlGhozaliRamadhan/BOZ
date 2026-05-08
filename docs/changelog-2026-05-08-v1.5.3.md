# Changelog — v1.5.3 (2026-05-08)

> **Focus:** Anti-Hallucination Hardening + Intelligence Expansion for `NewsIntelAgent`
>
> All changes discussed in today's session. Two primary themes:
> 1. **Hallucination reduction** — structural guards that make it mechanically harder for the model to fabricate prices, correlations, or overconfident signals.
> 2. **Intelligence expansion** — three new data tools (social velocity, catalyst calendar, price momentum) and a session memory system for retrospective self-review.

---

## Anti-Hallucination System

### BaseAgent — Lower Loop Temperature (`0.3 → 0.12`)
- **File:** `src/agents/base.agent.ts`
- The ReAct loop's `callAIWithRetry()` default temperature was lowered from `0.3` to `0.12`.
- Higher temperatures cause the model to "creatively fill" gaps with invented numbers (prices, percentages, correlations) when real data is unavailable.
- `0.12` keeps tool-calling decisions deterministic and fact-anchored. The meta-summary `callAIText()` retains `0.5` — narrative writing benefits from some creativity.

### NewsIntelAgent — Citation Gating on `emit_opportunities`
- **File:** `src/agents/news.intel.agent.ts`
- Added mandatory `sources: string[]` field to the `emit_opportunities` tool schema and `AgentOpportunity` interface.
- The agent must list every tool call backing a setup (e.g. `["fetch_price:BTC", "fetch_news:all", "fetch_fear_greed"]`).
- If a BUY or SELL opportunity is emitted without `fetch_price` in its sources and the asset isn't in `state.fetchedAssets`, the handler **automatically downgrades it to WATCH** and caps confidence at 55%.
- Prevents the most common hallucination pattern: emitting a `BUY BTC at $68,000` entry without ever having fetched the live price.

### NewsIntelAgent — Price Provenance Tracking (`priceCache`)
- **File:** `src/agents/news.intel.agent.ts`
- New `priceCache: Map<string, number>` added to `AgentState`. Populated by `toolFetchPrice()` whenever a live quote succeeds.
- `toolEmitOpportunities()` looks up `priceCache` and auto-fills `spot_price` on every opportunity object — no manual entry by the model required.
- The final renderer already displayed `spot_price`; now it is always sourced from a real API call rather than left blank or guessed.

### NewsIntelAgent — `[GROUNDING]` Footer on Every Data Tool Result
- **File:** `src/agents/news.intel.agent.ts`
- New `AgentState.mentionedAssets: Set<string>` tracks every asset tag found in news headlines (populated in `toolFetchNews()`).
- After every data-fetching tool call (`fetch_news`, `fetch_price`, `fetch_fear_greed`, `fetch_trending_crypto`, `search_news_by_asset`, `fetch_social_sentiment`, `fetch_price_momentum`), a grounding footer is appended to the observation:
  ```
  [GROUNDING] Price NOT fetched for: BTC, ETH, GOLD, SPY
  Do NOT reference prices for these assets without calling fetch_price first.
  ```
- Each result is also stamped with `[DATA @ HH:MM:SS]` so the model knows exactly how old its data is when reasoning later in the session.

### NewsIntelAgent — `audit_claims` Tool (Mandatory Gate Before `finish`)
- **File:** `src/agents/news.intel.agent.ts`
- New tool added to `TOOL_DEFINITIONS`. The agent **must** call this before `finish`.
- The agent self-reports each opportunity: `price_fetched`, `evidence_count`, `confidence_justified`, `corrections`.
- The handler programmatically enforces corrections:
  - `price_fetched: false` on a BUY/SELL → auto-downgraded to WATCH, confidence capped at 55%.
  - `confidence_justified: false` with confidence >65 → reduced by 15 points, capped at 65%.
- The `finish` tool description was updated to make `audit_claims` a hard prerequisite.
- Log output shows `[CORRECTED]` or `[OK]` per asset.

### NewsIntelAgent — Anti-Fabrication Rules in System Prompt
- **File:** `src/agents/news.intel.agent.ts`
- Added a new `─── ANTI-FABRICATION RULES — MANDATORY ───` section to `buildSystemPrompt()` with five explicit rules:
  - **RULE 1** — No price without `fetch_price`
  - **RULE 2** — Confidence is evidence-gated (thresholds: >80%, 65-80%, 50-65%, <50%)
  - **RULE 3** — No causal claims without a news source
  - **RULE 4** — Contradict explicitly ("CORRECTION: I stated X but data shows Y")
  - **RULE 5** — `audit_claims` before `finish`, non-negotiable

---

## Intelligence Expansion

### New Tool — `fetch_social_sentiment` (Reddit Velocity)
- **File:** `src/agents/news.intel.agent.ts`
- Scans Reddit's public JSON API (no auth required) across segment-appropriate subreddits:
  - `crypto` → `r/CryptoCurrency`, `r/Bitcoin`
  - `stocks` → `r/wallstreetbets`, `r/stocks`
  - `macro`  → `r/Economics`, `r/investing`
- Returns:
  - **Posts-per-hour velocity** — how many hot posts were created in the last 60 minutes (breaking story detector)
  - **Top post titles** tagged `[VIRAL]` (>2k upvotes), `[HOT]` (>500), `[NORM]`
  - **Inline sentiment scan** — regex keyword pass per title, aggregated to `N bullish / N bearish`
- Grounding footer and `[DATA @ HH:MM:SS]` timestamp applied automatically.
- Designed to surface crowd narrative shifts **before** they appear in mainstream RSS feeds.

### New Tool — `scan_upcoming_catalysts` (Economic Calendar + Crypto Events)
- **File:** `src/agents/news.intel.agent.ts`
- Fetches the **Forex Factory economic calendar** (`nfs.faireconomy.media/ff_calendar_thisweek.json`) — public, no API key.
- Filters for `impact: "High"` events within the next 72 hours. Returns country, event name, forecast, and previous value.
- Additionally checks time-based **crypto recurring events**:
  - CME BTC/ETH weekly futures expiry (Friday 16:00 UTC)
  - Weekend thin-liquidity warning (Saturday)
  - US pre-market gap window (09:00–14:00 UTC)
  - CME monthly expiry proximity alert (≤2 days out)
- All catalysts found are stored in `state.catalystsFound: string[]` and persisted to the session log.
- The initial prompt and system prompt both instruct the agent to run this tool first and to label setups that run into a risk event as "hold until post-event."

### New Tool — `fetch_price_momentum` (7-Day OHLCV via Yahoo Finance Chart API)
- **File:** `src/agents/news.intel.agent.ts`
- Calls the public Yahoo Finance chart endpoint (`query1.finance.yahoo.com/v8/finance/chart/`) — no API key required — for 7-day daily OHLCV data.
- Computes:
  - **1d / 3d / 7d returns** (percentage)
  - **Trend classification**: `UPTREND` (3d >+2%), `DOWNTREND` (3d <-2%), `SIDEWAYS`
  - **Momentum state**: `ACCELERATING` (1d move > average daily 3d move) vs `FADING`
  - **Volume ratio**: current day vs 7-day average (`1.4x avg` etc.)
- Warnings fired automatically:
  - >5% 1-day move → overextension or breakout alert
  - Fading momentum inside a directional trend → reversal caution
- Momentum is stored in `state.momentumCache: Map<string, string>` (keyed by asset + symbol) for reference in later reasoning steps.
- System prompt now instructs the agent to call `fetch_price_momentum` **after** `fetch_price` for every BUY/SELL candidate. Fading momentum = signal exhaustion; accelerating + social buzz = conviction booster.

### Conviction Calibration — `conviction` Field on Every Opportunity
- **File:** `src/agents/news.intel.agent.ts`
- New `conviction: 'HIGH' | 'MEDIUM' | 'SPECULATIVE'` field added to `AgentOpportunity` interface and `emit_opportunities` schema (required).
- Definitions:
  - **HIGH** — 3+ independent signals align. BUY/SELL allowed at confidence >70.
  - **MEDIUM** — 2 signals align. BUY/SELL allowed at confidence 55-70.
  - **SPECULATIVE** — Technical + macro align but confirmation missing (e.g. waiting on a catalyst). Confidence 40-55, WATCH preferred. Agent is explicitly instructed to **still emit** speculative setups with clear invalidation — a labelled speculative call is more useful than silence.
- Final renderer displays conviction as a color-coded badge per opportunity:
  - 🟢 `[HIGH]` (green)
  - 🟡 `[MEDIUM]` (yellow)
  - 🟣 `[SPECULATIVE]` (magenta)

---

## Session Memory & Retrospective Loop

### New Service — `session.log.service.ts`
- **File:** `src/services/session.log.service.ts` *(new file)*
- Persists each `NewsIntelAgent` session to `data/session.log.json` (last 10 sessions retained, older entries auto-pruned).
- Each `SessionEntry` stores:
  - `timestamp`, `regime`, `marketSummary`, `catalysts`, `toolCallCount`
  - All emitted opportunities with `asset`, `action`, `conviction`, `confidence`, `entry_range`, `target_range`, `stop_loss`, `spot_price`
- On the **next run**, `buildInitialPrompt()` loads the most recent session and injects a formatted retrospective block:
  ```
  ── PREVIOUS SESSION RETROSPECTIVE (2h ago) ──
  Regime: RISK_ON  |  Summary: BTC led by ETF inflows...
  Calls made (3):
    • BUY BTC @ HIGH conviction (78%) — entry 62000-63500, target 68000, spot was $62,800
    • WATCH GOLD @ SPECULATIVE (52%) — entry 2280-2300, ...
  RETROSPECTIVE TASK: For each call above, check the live price now.
  If it moved in the predicted direction → note "AGED WELL".
  If it moved against → note "MISS" and briefly explain why.
  ```
- The agent's first task each new session is to retrospectively evaluate its prior calls before making new ones — a lightweight self-learning loop without model fine-tuning.
- `data/session.log.json` is created automatically; no configuration required.

---

## Prompt & Workflow Updates

### `buildInitialPrompt()` — Structured Workflow Guidance
- **File:** `src/agents/news.intel.agent.ts`
- Replaced the freeform initial prompt with a structured workflow sequence:
  1. `scan_upcoming_catalysts` — anchor to macro calendar first
  2. `fetch_news` — broad context
  3. `fetch_fear_greed` — crowd sentiment baseline
  4. `fetch_price` + `fetch_price_momentum` — for every BUY/SELL candidate
  5. `fetch_social_sentiment` — for narrative velocity checks
  6. `emit_opportunities` with conviction labels (including SPECULATIVE)
  7. `audit_claims` → `finish`
- Retrospective context from the previous session is prepended when available.

### `buildSystemPrompt()` — Conviction & Catalyst Awareness Sections
- **File:** `src/agents/news.intel.agent.ts`
- Added `CONVICTION LEVELS` guidance to `─── ANALYTICAL STANDARDS ───`:
  - Defines HIGH / MEDIUM / SPECULATIVE with explicit confidence thresholds
  - Emphasises that SPECULATIVE signals with clear invalidation are valuable, not noise
- Added `CATALYST AWARENESS` block: catalyst-backed setup = +20% conviction; setup running into a risk event = "hold until post-event"
- Added `MOMENTUM CONTEXT` block: instructs the agent to treat fading momentum as signal exhaustion and accelerating momentum + social buzz as a conviction booster

---

## Files Changed Summary

| File | Type | Change |
|---|---|---|
| `src/agents/base.agent.ts` | Modified | Loop temperature `0.3 → 0.12` |
| `src/agents/news.intel.agent.ts` | Modified | Anti-hallucination guards, 3 new tools, conviction field, audit_claims, session persistence, prompt rewrites |
| `src/services/session.log.service.ts` | **New** | Session persistence + retrospective context builder |

---

## Known Limitations / Notes

- `fetch_social_sentiment` uses Reddit's public `.json` API which can occasionally rate-limit (HTTP 429) during high-traffic periods. The grounding footer still appears even if Reddit is unavailable.
- `scan_upcoming_catalysts` uses the Forex Factory public JSON feed which does not include all economic calendars (e.g. ECB minutes). Major US events (CPI, NFP, FOMC) are always present.
- `fetch_price_momentum` uses Yahoo Finance's unauthenticated chart endpoint. This endpoint has been stable for years but is unofficial and may change. A `try/catch` with graceful fallback message is in place.
- The `data/session.log.json` retrospective is only as useful as the agent's ability to correctly compare predicted direction vs. current price. The agent must call `fetch_price` for retrospective assets — it is instructed to do so but this is not mechanically enforced (it's a prompt instruction, not a code gate).
