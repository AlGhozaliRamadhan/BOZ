# BOZ v1.5.5 Changelog

**Date:** May 11, 2026

## Changed

- **MarketAnalyzer is now interval-aware:**
  - 1h/4h/24h change and volatility metrics are computed by timestamp windows, not fixed bar counts.
  - Makes intraday (1h) and daily (1d) summaries accurate without relabeling.
  - File: `src/analyzers/market.analyzer.ts`
- **Incomplete-bar handling for intraday:**
  - If the latest bar is still forming, intraday summary drops it to avoid skewed metrics.
  - Long-term daily summaries keep the latest bar and use a daily interval.
  - Files: `src/analyzers/market.analyzer.ts`, `src/analyzers/nvda.intraday.analyzer.ts`, `src/analyzers/nvda.longterm.analyzer.ts`
- **True 4h resampling + regular-hours filtering:**
  - 4h candles are now constructed from 1h bars instead of being mislabeled.
  - Optional regular-hours filter keeps equities in the 09:30-16:00 ET session.
  - Files: `src/services/yahoo.service.ts`, `src/analyzers/nvda.intraday.analyzer.ts`
- **Adjusted-price long-term data + weekly aggregation:**
  - Long-term daily candles now use adjusted prices for split/dividend accuracy.
  - Weekly trend is built from calendar-week aggregation instead of sampling every 5 bars.
  - Files: `src/services/yahoo.service.ts`, `src/analyzers/nvda.longterm.analyzer.ts`
- **Macro correlation/beta upgrade (SPY/QQQ + optional VIX/TNX):**
  - Added 60d correlation and beta vs SPY/QQQ.
  - Optional VIX and 10Y yield context included in prompts.
  - Files: `src/services/macro.service.ts`, `src/shared/prompts.ts`, `src/types/types.ts`
- **AI rationale + social media search:**
  - Market analyzers now request structured reasons (top 3) and display them in output.
  - Added Reddit social buzz search for the active ticker.
  - Files: `src/services/ai.service.ts`, `src/shared/prompts.ts`, `src/analyzers/nvda.intraday.analyzer.ts`, `src/analyzers/nvda.longterm.analyzer.ts`, `src/services/sentiment.service.ts`
- **AI prompt bias guard cleanup:**
  - Removed the old anti-bias checklist after observing reduced accuracy.
  - Replaced with a concise, data-grounded accuracy check.
  - File: `src/services/ai.service.ts`

## Notes

- This release focuses on signal accuracy for market summaries and removes a prompt rule that was over-constraining the model.
