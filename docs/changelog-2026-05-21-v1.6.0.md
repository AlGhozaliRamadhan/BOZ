# BOZ v1.6.0 Changelog

**Date:** May 21, 2026

## Added & Improved

- **Percentile-Based Indicators & Volatility Regimes (Component 1)**
  - Transitioned Bollinger Bands squeeze thresholds from absolute values to relative, rolling historical width percentiles (bottom 10% for tight squeeze, bottom 25% for squeezing, top 25% for expanding).
  - Upgraded Volatility Regime classifications to use rolling historical return standard deviation percentiles (bottom 10% extremely low, bottom 25% low, top 10% extreme, top 25% high).
  - Implemented `computeOBVDivergence` to detect bullish and bearish divergences using peak and trough price/volume pivot analyses.
  - Added dynamic short-term (5-bar) vs. medium-term (20-bar SMA) volume comparison to classify `volume_trend`.
  - File: `src/analyzers/market.analyzer.ts`

- **Multi-Timeframe & Target Fallbacks (Component 2 & 3)**
  - Expanded historical intraday lookback window from 5 days to 20 days.
  - Replaced raw signal scoring that penalizes missing timeframe data with a dynamically scaled metric calculated only across active timeframe indicators.
  - Added ATR-based stop/target math fallbacks for both intraday (Long: +2*ATR/-1.5*ATR; Short: -2*ATR/+1.5*ATR) and long-term (Long: +6*ATR/-4*ATR; Short: -6*ATR/+4*ATR) engines.
  - Corrected weekly trend calculations to compare current closes against a 10-week SMA of weekly closes with a ±2% sideways buffer, while computing overall 2-year `weeklyChange` over the full range, preventing modulus downsampling aliasing.
  - Files: `src/analyzers/intraday.analyzer.ts`, `src/analyzers/longterm.analyzer.ts`

- **Technical Chart Pattern Recognition & Candle Conflict Resolution (Component 4)**
  - Expanded lookback window for pattern scanning to 120 candles.
  - Added detection for: Head & Shoulders, Inverse Head & Shoulders, Triple Tops, Triple Bottoms, and Symmetrical/Ascending/Descending Triangles.
  - Implemented confidence-weighted candlestick conflict resolution (HIGH = 3, MEDIUM = 2, LOW = 1) to determine directional bias scientifically, and logged the logic in output summaries.
  - File: `src/analyzers/chart.analyzer.ts`

- **Enriched Services & Macro Data (Component 5)**
  - Combined Yahoo Finance news queries with aggregated RSS feeds from `newsFetchService` with deduplication and ticker-based keyword filtering.
  - Added SPY-based `market_regime` detection (`'BULL_CONFIRMED' | 'BULL_CORRECTION' | 'BEAR_CONFIRMED' | 'BEAR_RECOVERY'`) using its 50-day SMA and its 20-day return momentum.
  - Standardized TNX yield reporting dynamically across scales (decimals, percentages, and scaled-by-10).
  - Populated tech sector relative strength and performance by fetching XLK alongside SPY and QQQ.
  - Files: `src/services/news.service.ts`, `src/services/macro.service.ts`

- **AI Layer Upgrades (Component 6 & 7)**
  - Separated LLM instructions (preamble, reasoning rules, validation checklists, schema rules) into the `system` message and supplied ticker data only into the `user` message.
  - Upgraded the default model configuration to favor `openai/gpt-4o`.
  - Injected contrarian Fear & Greed indices, StockTwits sentiment metrics, and caution signals into `buildLongTermPrompt`.
  - Files: `src/services/ai.service.ts`, `src/config/github.config.ts`, `src/shared/prompts.ts`

- **Git & Safety Enhancements**
  - Updated configuration exclusions to ignore local private keys (`*.pem`, `*.key`, `*.pfx`, `*.cert`), testing/build caches (`.vitest/`, `.pnpm-store/`), and general system temp directories.
  - File: `.gitignore`

## Removed

- **Dead Code Cleanup (Component 8)**
  - Removed unused and redundant `getRealtimePrice` method from `YahooService`.
  - File: `src/services/yahoo.service.ts`

## Verification & Tests

- Checked TypeScript type safety with `npx tsc --noEmit`. No errors found.
- Executed `npm test`. All 27 unit and integration tests passed successfully.

## Notes

- All changes are fully backwards compatible.
- The upgraded model (`openai/gpt-4o`) provides deeper analytical reasoning, especially when processing new multi-pattern configurations.
