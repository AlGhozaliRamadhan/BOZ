# Changelog — v1.4 (2026-05-04)

## New Features

### Multi-Ticker Support
- **File:** `src/cli/cli.ts`, `src/main.ts`
- Extended the analysis pipeline to support analyzing multiple tickers in a single run.
- Users can now pass comma-separated ticker symbols or use a configuration file to specify multiple targets.
- Each ticker follows the same orchestrated analysis pipeline independently.

### Extended Analysis Horizons
- **File:** `src/analyzers/nvda.longterm.analyzer.ts`
- Expanded long-term analysis window from daily to weekly and monthly timeframes.
- Added new technical patterns for swing and position trading strategies.
- Macro context now includes longer-term trend analysis (3-month, 6-month, 1-year).

### Enhanced News Sentiment Analysis
- **File:** `src/services/sentiment.service.ts`
- Implemented sentiment scoring for news headlines using keyword analysis.
- News items now include bullish/bearish sentiment flags in addition to raw text.
- Improved fallback behavior when sentiment data sources are unavailable.

### Configuration Flexibility
- **File:** `src/config/config.ts`
- Added support for loading analysis settings from `.boz.config.json` at project root.
- Users can now customize:
  - analysis interval (1h, 4h, 1d, 1w)
  - number of lookback periods
  - indicator parameters (RSI periods, SMA windows, etc.)
  - output format (JSON, CSV, human-readable)

## Improvements

### Performance Optimization
- **File:** `src/services/yahoo.service.ts`
- Implemented caching layer for market data with configurable TTL (time-to-live).
- Reduced redundant API calls when analyzing multiple timeframes of the same ticker.
- Added batch request support for fetching multiple tickers' quotes simultaneously.

### Better Error Recovery
- **File:** `src/services/macro.service.ts`, `src/services/ai.service.ts`
- Enhanced error handling with exponential backoff on API failures.
- Added retry logic for transient network errors (up to 3 attempts).
- Improved fallback chains: if GitHub Models fails, gracefully degrades to offline Ollama.

### Logging and Observability
- **File:** `src/utils/logger.ts`
- Added structured logging with configurable log levels (debug, info, warn, error).
- Execution timeline now logged: duration for each pipeline stage.
- Performance metrics exported in JSON format for analysis (`--log-format=json`).

### Type Safety & Developer Experience
- **File:** `src/types/types.ts`
- Added generic `AnalysisResult<T>` type for extensibility to future analysis types.
- Improved discriminated unions for `AIResult` to cover 'partial' status (partial confidence response).
- Better JSDoc comments for complex configuration objects.

## Bug Fixes

### Macro Context SPY/QQQ Stale Data Detection
- **File:** `src/services/macro.service.ts`
- Added timestamp validation: macro data older than 1 hour now triggers a `STALE_DATA` warning.
- Falls back to recalculating macro context on next run instead of silently using old data.

### Chart Pattern Timing Off by 1 Candle
- **File:** `src/analyzers/chart.analyzer.ts`
- Peak/trough detection now uses correct UTC hour boundary for intraday charts.
- Fixes rare edge case where patterns were assigned to wrong time index.

### Sentiment Bull Ratio Calculation for Zero Activity
- **File:** `src/services/sentiment.service.ts`
- Division by zero guard added: when neither bullish nor bearish messages exist, ratio defaults to 50 (neutral).
- Prevents `NaN` propagation through AI prompt.

## Project / Infrastructure

### Version Bump Across System
- **Files:** `package.json`, `src/analyzers/nvda.intraday.analyzer.ts`, `src/analyzers/nvda.longterm.analyzer.ts`
- Updated version strings and version headers to `v1.4`.

### Documentation Expansion
- **Files:** Added `docs/usage-guide.md`, `docs/configuration.md`, `docs/api-reference.md`
- Comprehensive user guide for CLI options and configuration file format.
- API reference for extending with custom analyzers.
- Configuration examples for common use cases (day trading, swing trading, position trading).

### Dependency Updates (Security)
- **File:** `package.json`
- Updated `yahoo-finance2` to latest patch version.
- Updated `@types/node` to latest stable version.
- No breaking changes to the API surface.

## Known Limitations

- Multi-ticker analysis runs sequentially (not parallel) — parallel support planned for v1.5.
- Weekly/monthly timeframe analysis unavailable for intraday volatility metrics (by design).
- Sentiment analysis currently English-only; multilingual support requires additional NLP models.

## Next Steps (v1.5 Roadmap)

- Parallel multi-ticker execution with configurable worker pool.
- WebSocket support for real-time streaming data (vs. polling).
- Plugin system for custom analyzers and indicators.
- Web dashboard UI for visualization and alert management.
