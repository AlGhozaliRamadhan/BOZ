# Changelog - 2026-05-03

## Version 1.0.0 (Initial)

This entry records the current state of Boz as of May 3, 2026.

## Product Direction

- Boz is positioned as an open-source AI market analyzer.
- The live implementation is still intraday and currently optimized for NVDA workflows.
- Main analysis horizon is short-term intraday context (next 2-6 hours), with 1h bars as the primary working interval.

## What Was Added Today

- README was upgraded to a professional open-source project presentation.
- GitHub metadata was added to package.json:
	- repository URL
	- issues URL
	- homepage
- Package description and market-focused keywords were updated.
- Author field was set to AGR.

## Current Intraday NVDA Pipeline

Boz currently runs an orchestrated NVDA flow in this order:

1. Fetch intraday market candles for NVDA from Yahoo Finance.
2. Compute technical indicators (RSI, MACD, SMA, Bollinger, ATR, OBV, volume ratio).
3. Build market summary and trend/pattern context.
4. Pull macro context (SPY and QQQ directional behavior).
5. Pull NVDA-related news headlines.
6. Pull crowd sentiment (Fear and Greed + StockTwits NVDA stream).
7. Construct AI prompt with all above data and request structured prediction.
8. Parse AI response into:
	 - prediction direction
	 - confidence
	 - strategy
	 - target price
	 - stop loss

## Data Sources and API Behavior

### 1) Market data (Yahoo Finance)

- Library: yahoo-finance2
- Endpoint usage pattern:
	- chart(symbol, { period1, interval, includePrePost: true })
	- quote(symbol) for real-time comparison
- Intraday setup:
	- Primary pull: NVDA 1h candles from last ~5 days.
	- Additional pulls for context: 4h and 1d windows.
- Data quality behavior:
	- candles with null close are removed
	- freshness is logged from latest candle timestamp
	- stale data warning appears when data age exceeds threshold

### 2) News search

- Source: yahoo-finance2 search(symbol, { newsCount: 5 })
- Behavior:
	- pulls latest headline set for the ticker
	- maps to plain list for prompt injection
	- falls back to "No significant news available" if no items are returned

### 3) Crowd sentiment pull

- Source A (equity regime mood):
	- https://production.dataviz.cnn.io/index/fearandgreed/graphdata
- Source B fallback:
	- https://api.alternative.me/fng/?limit=1
- Source C (ticker crowd bias):
	- https://api.stocktwits.com/api/2/streams/symbol/NVDA.json

Behavior details:

- Fear and Greed score is normalized and labeled.
- StockTwits messages are counted for Bullish vs Bearish tags.
- bull_ratio is computed as:
	- bullish / (bullish + bearish) * 100
- Summary flags are generated:
	- EXTREME_FEAR
	- EXTREME_GREED
	- CROWD_BULLISH
	- CROWD_BEARISH
	- NEUTRAL (fallback)

## AI Analysis Flow

### Provider model

- Supports two AI providers:
	- GitHub Models
	- Offline Ollama-compatible endpoint

### GitHub Models request flow

- Endpoint: {GITHUB_AI_ENDPOINT}/chat/completions
- Authorization: Bearer GITHUB_TOKEN
- Payload includes:
	- model
	- messages
	- temperature
	- max_tokens
- Timeout: 90 seconds

Fallback behavior:

- Uses selected primary model first.
- If rate limited (HTTP 429), timeout, or model error, falls through to fallback models.
- Stops early on auth failures (401/403).

### Offline request flow

- Endpoint: {OFFLINE_AI_URL}/api/chat
- Payload includes model + messages, non-stream mode.
- Same timeout guard is applied.

### Output contract

Boz expects this structured AI format:

- PREDICTION: UP or DOWN
- CONFIDENCE: 0-100
- STRATEGY: short text
- TARGET: price
- STOP: price

When structured fields are missing, Boz keeps raw text and marks prediction as UNKNOWN with default confidence.

## Current Scope Note

- Product messaging is now market-wide/open-source.
- Runtime analyzer logic is still NVDA-centric in the current code path.
- Intraday behavior remains the core operating mode.

## Next Evolution Targets

- Generalize analyzer orchestration from NVDA-only to multi-ticker runtime input.
- Separate terminal UI text from core engine output for cleaner API/service reuse.
- Add test coverage for:
	- sentiment parsing
	- AI structured response parsing
	- stale-data and fallback conditions
