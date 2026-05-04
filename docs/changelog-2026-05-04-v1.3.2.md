# Changelog — v1.3.2 (2026-05-04)

## Bug Fixes

### `vol1h` was always `0` — volatility regime detection broken
- **File:** `src/analyzers/market.analyzer.ts`
- `stdDev(returns.slice(-1))` computes the standard deviation of a single value, which is
  mathematically always `0`. This caused the volatility regime to almost always read
  `EXTREMELY_LOW` regardless of real market conditions.
- **Fix:** Changed to `slice(-4)` (4-bar window) and `slice(-16)` for vol4h for a more
  meaningful rolling sample.

### `findPeaks` ignored its `threshold` parameter — false double-top/bottom signals
- **File:** `src/analyzers/chart.analyzer.ts`
- The `threshold` parameter was declared (`= 0.012`) but never referenced in the loop body,
  meaning every local maximum, including tiny noise ticks, triggered a pattern signal.
- **Fix:** Applied a relative threshold check: peaks must exceed neighbours by ≥ threshold %.

### `is_incomplete_candle` was hardcoded `true`
- **File:** `src/analyzers/market.analyzer.ts`
- The field was always `true` regardless of actual candle state. The AI prompt context never
  saw a `false` value.
- **Fix:** Now computed by comparing the candle's UTC timestamp to the current UTC hour.

### Silent `catch (err) {}` in `MacroService` hid SPY/QQQ fetch errors
- **File:** `src/services/macro.service.ts`
- Both SPY and QQQ fetch errors were swallowed with empty catch blocks. If Yahoo Finance
  failed, the AI received default/stale macro context with no warning.
- **Fix:** Added `log.warn('macro', ...)` in both catch blocks.

### `GITHUB_TOKEN_URL` defined in 3 separate files
- **Files:** `src/services/ai.service.ts`, `src/cli/cli.ts`, `src/utils/setup.ts`
- The URL string was copy-pasted verbatim across three files, making it a maintenance hazard.
- **Fix:** Moved to a single export in `src/config/github.config.ts`; all consumers now import it.

### `config.setAIProvider('github')` called twice in startup wizard
- **File:** `src/cli/cli.ts` (`runStartupWizard`)
- The provider was applied at line ~260 and again at line ~272 within the same `if` branch.
- **Fix:** Removed the redundant second call.

## Type Safety Improvements

### `Candle` interface used `[key: string]: any` index signature
- **File:** `src/types/types.ts`
- The open-ended index signature defeated TypeScript's type checking for all computed
  indicator properties (`SMA_20`, `RSI`, `MACD`, etc.).
- **Fix:** Replaced with explicit optional typed fields for all 17 indicator properties.

### `MarketData` used `number | string` for numeric fields
- **File:** `src/types/types.ts`
- Fields like `change_4h`, `price_vs_sma50`, `price_vs_sma200`, `range_24h_pct` were typed
  `number | string` (legacy from Python port). Every consumer wrapped them in `Number(...)`.
- **Fix:** Changed to `number` (always-computed fields) or `number | null` (optional fields).
  All `Number()` wrappers and `!== 'N/A'` string checks updated accordingly.

### `AIResult` converted to a discriminated union
- **File:** `src/services/ai.service.ts`
- All fields were optional, causing `?? 0` and `?? (entry * 1.02)` fallbacks throughout
  every analyzer. TypeScript had no way to narrow the type after a status check.
- **Fix:** `AIResult` is now a discriminated union on `status`:
  - `'ok'` — `prediction` and `confidence` are required; `target_price`/`stop_loss` remain optional
  - `'error'` / `'uncertain'` — only `reason` present

### `MacroService.getMacroContext()` returned `Promise<any>`
- **File:** `src/services/macro.service.ts`
- Consumers had no type safety on macro fields like `market_regime`, `risk_sentiment`.
- **Fix:** Added `MacroContext` interface to `src/types/types.ts`; method now returns `Promise<MacroContext>`.

## Project / Infrastructure

### Dead file `src/utils/setup.ts` removed
- `promptForGitHubToken` and `ensureGitHubToken` were never imported anywhere. `cli.ts` had
  its own complete inline implementations. The file was pure dead code.
- **Action:** File deleted.

### `package.json` corrected
- `"main": "index.js"` → `"main": "dist/main.js"` (the file actually exists after build)
- `@types/node` moved from `dependencies` → `devDependencies`
- `@types/prompts` removed (package unused since migration to raw readline)
- `prompts` removed (unused; raw readline is used instead)
- `ts-node` removed (never used; `tsx` is the actual runner)

### `.editorconfig` added
- Enforces LF line endings and 2-space indentation across the project.
- Resolves the mixed CRLF/LF inconsistency between `src/` files.

### Fallback model order in AI waterfall corrected
- **File:** `src/services/ai.service.ts`
- `FALLBACK_MODELS` previously had `gpt-5` as the first fallback (more restricted).
  Changed to `gpt-4o-mini` first (highest availability), then `gpt-5`.

### Version strings in analyzer headers updated to `v1.3.2`
- `NVDAIntradayAnalyzer` and `NVDALongTermAnalyzer` output headers now reflect the current version.
