# BOZ v1.5.8 Changelog

**Date:** May 18, 2026

## Added

- **Data freshness visibility (intraday + long-term)**
  - Outputs and AI prompts now include latest candle time (UTC), data age, stale threshold, and incomplete candle flags to avoid false recency assumptions.
  - Files: `src/analyzers/intraday.analyzer.ts`, `src/analyzers/longterm.analyzer.ts`, `src/shared/prompts.ts`, `src/utils/data-freshness.ts`

- **Hard tool-use enforcement for opportunities**
  - `emit_opportunities` is blocked unless `scan_upcoming_catalysts`, `fetch_news`, and `fetch_fear_greed` have run.
  - Each opportunity must cite tool sources, and `fetch_price` + `fetch_price_momentum` are now required per asset before emission.
  - Emitted opportunities now show their `sources` in the final output.
  - File: `src/agents/news.intel.agent.ts`

- **Rate-limit resilience on news/sentiment**
  - Added exponential backoff + jitter on 429/5xx and transient network errors for news RSS/API calls and sentiment fetches.
  - Files: `src/services/news.fetch.service.ts`, `src/services/sentiment.service.ts`

- **Build version override via .env.build**
  - CLI/analyzer version banners now prefer `BOZ_VERSION` from `.env.build` before falling back to `package.json`.
  - File: `src/utils/version.ts`
  - Global install now writes `.env.build` into the module directory during `npm run build`.
  - File: `scripts/install-global.js`

## Tests

- **Indicator calculations**: volume SMA/ratio and OBV SMA alignment
  - File: `tests/indicators.service.test.ts`
- **Prompt formatting**: data freshness appears in intraday and long-term prompts
  - File: `tests/prompts.test.ts`
- **LLM JSON extraction**: code-fence stripping and trimming around JSON
  - File: `tests/llm.adapter.test.ts`

## Notes

- No breaking changes to CLI usage.
- Yahoo candle age is now surfaced prominently to avoid delayed-data confusion.
