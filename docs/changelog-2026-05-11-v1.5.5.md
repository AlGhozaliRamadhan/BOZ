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
- **AI prompt bias guard cleanup:**
  - Removed the old anti-bias checklist after observing reduced accuracy.
  - Replaced with a concise, data-grounded accuracy check.
  - File: `src/services/ai.service.ts`

## Notes

- This release focuses on signal accuracy for market summaries and removes a prompt rule that was over-constraining the model.
