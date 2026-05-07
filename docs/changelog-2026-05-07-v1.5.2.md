# Changelog — v1.5.2 (2026-05-07)

## Improvements

### Chart Pattern Detection — Tightened Double Top/Bottom Signals
- **File:** `src/analyzers/chart.analyzer.ts`
- Added minimum peak/trough separation and a price proximity check to avoid firing on noisy 1h volatility.
- Confidence now scales: `LOW` when separation just meets the minimum and `HIGH` when the pattern is well-formed.

### AI Prompt Builders — Centralized Intraday + Long-Term Prompts
- **Files:** `src/shared/prompts.ts`, `src/analyzers/nvda.intraday.analyzer.ts`, `src/analyzers/nvda.longterm.analyzer.ts`
- Extracted the long prompt strings into typed builder functions so the reasoning framework and contrarian rules live in one place.
- Analyzers now call `buildIntradayPrompt(...)` and `buildLongTermPrompt(...)`, making prompts easier to test and update.

### CI Pipeline — Typecheck + Tests on Push/PR
- **File:** `.github/workflows/ci.yml`
- Added a minimal CI workflow that runs `tsc --noEmit` and `npm test` on every push and pull request.

### Agent Autonomous Thinking — Removed Forced Iteration
- **File:** `src/agents/news.intel.agent.ts`
- The `NewsIntelAgent` no longer steps through a forced iteration counter to drive its loop. Previously the loop nudged the agent forward on each cycle regardless of whether it had reached a natural decision point, which caused shallow reasoning and premature tool calls just to satisfy the iteration budget.
- The agent now runs a pure condition-based loop: it keeps going as long as `state.finished` is `false` and stops the moment it calls `finish` — whenever that naturally happens. The AI decides the pace and depth of its own investigation rather than being pushed by an external counter.
- Result: sessions with a clear market picture resolve faster and cleaner; sessions with conflicting signals or unexpected data go as deep as the evidence demands.

### Agent Architecture Cleanup — Removed Redundant Re-export Shim
- **Files:** `src/analyzers/news.intel.agent.ts` (deleted), `src/cli/cli.ts`
- `src/analyzers/news.intel.agent.ts` was a one-line re-export that proxied `NewsIntelAgent` from `src/agents/news.intel.agent.ts`. It served no purpose beyond creating a misleading import path that suggested the agent lived in `analyzers/`.
- Deleted the shim. Updated `cli.ts` to import `NewsIntelAgent` directly from `../agents/news.intel.agent.js` where the class actually lives.
- `analyzers/` now contains only analyzers. `agents/` owns its own classes.

---

## Bug Fixes & Improvements (session 2026-05-07 evening)

### BaseAgent — 429 / 5xx Retry with Exponential Backoff
- **File:** `src/agents/base.agent.ts`
- Added private `callAIWithRetry()` that wraps every AI call with up to 3 attempts.
- Retries on HTTP 429 (rate-limit), any 5xx server error, and network-level codes (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`).
- Backoff is linear: 5 s → 10 s → 15 s. Non-retryable errors (400, 401, 403) still fail immediately.
- The loop now uses `callAIWithRetry` instead of calling `callAI` directly. A `loopError` flag tracks whether the exit was caused by an error vs. a normal cap or finish call.
- **Before:** a single 429 at step 4 silently killed the session and produced zero output. **After:** the agent retries transparently and only aborts after all attempts are exhausted.

### BaseAgent — Partial State Preserved on Error Exit
- **File:** `src/agents/base.agent.ts`
- When the loop exits due to a failed AI call (`loopError = true`) and the agent hasn't cleanly finished, `runLoop()` now calls `(this as any).synthesiseFinish?.(state)` before returning.
- Subclasses that expose `synthesiseFinish` (like `NewsIntelAgent`) will have their partial opportunities, regime, and recommended actions rendered rather than showing a blank output.
- **Before:** crash at step 4 → 0 opportunities, no regime, no summary. **After:** whatever the agent had accumulated up to the crash is always rendered.

### BaseAgent — Null-guard on `assistantMsg.content`
- **File:** `src/agents/base.agent.ts`
- Replaced the double null-check on `assistantMsg.content` with a single `content?.trim() ?? ''` into a `thoughtText` variable, reused for both the print and the empty-response nudge check. Eliminates a subtle inconsistency where the two checks could disagree.

### NewsIntelAgent — `synthesiseFinish` Made Public
- **File:** `src/agents/news.intel.agent.ts`
- Changed `private synthesiseFinish()` to `public` so the base class error-exit hook can invoke it via the dynamic call without requiring a cast in a subclass override.

### NewsIntelAgent — `toolFetchNews` Delegates Fully to Singleton
- **File:** `src/agents/news.intel.agent.ts`
- Added a comment making explicit that `toolFetchNews()` re-uses the `newsFetchService` singleton's disk+memory cache. Two agents running back-to-back (or simultaneously) now share one fetched copy within the TTL window instead of double-fetching.

### NewsIntelAgent — `generateSessionSummary` Graceful Fallback
- **File:** `src/agents/news.intel.agent.ts`
- Previously returned `''` on AI failure, causing a completely blank post-session section.
- Now assembles a plain-text fallback from `state.marketSummary`, `state.riskWarnings`, and `state.contrarian` and returns that instead.
- The renderer then displays it under `MARKET SUMMARY` so something always shows even when the meta-summary AI call fails.

### NewsIntelAgent — `renderFinalOutput` Unified Summary Block
- **File:** `src/agents/news.intel.agent.ts`
- `AI META-SUMMARY` and `MARKET SUMMARY` were two separate blocks that both rendered unconditionally, sometimes producing a blank `MARKET SUMMARY` header with nothing under it.
- Now: if `metaSummary` has content → show `AI META-SUMMARY`; else if `state.marketSummary` has content → show `MARKET SUMMARY` as fallback. Mutually exclusive, no blank headers.

### NewsFetchService — Replaced Dead RSS Feeds
- **File:** `src/services/news.fetch.service.ts`
- `feeds.feedburner.com/CommodityHQ` (commodities) was returning 404 — removed and replaced with `investing.com/rss/news_14.rss` (Investing.com commodities feed).
- `feeds.reuters.com/reuters/businessNews` (economy) DNS no longer resolves (`ENOTFOUND`) — Reuters killed their public RSS years ago. Replaced with `feeds.bbci.co.uk/news/business/rss.xml` (BBC Business).
- Both replacements are stable, no-auth public feeds. The `[warn]` lines on every agent run are now gone.
- Note: the disk cache (`%TEMP%\boz-news-cache.json`) must expire or be deleted for the new feeds to take effect on an existing installation.
