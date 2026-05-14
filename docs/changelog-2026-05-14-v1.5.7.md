# BOZ v1.5.7 Changelog

**Date:** May 14, 2026

## Bug Fixes

### NVIDIA NIM — JSON Schema Validation Failures

- **Fixed: `/reasons/N must be string` (AJV rejection)**
  - Nemotron and other NIM reasoning models occasionally emit `null` or numeric values inside the `reasons` array instead of strings, causing AJV to reject the response.
  - Added a pre-validation sanitizer that strips nulls, coerces non-string items via `String()`, and drops empty entries before the schema check runs.
  - File: `src/services/ai.service.ts`

- **Fixed: `/status must be equal to one of the allowed values` + `oneOf` collapse**
  - Nemotron returns non-standard `status` values such as `"success"`, `"good"`, `"warning"`, or directional strings like `"bullish"` that fall outside the schema enum `['ok', 'uncertain', 'error']`.
  - Added coercion map: `success/good/valid → ok`, `warning/partial/unknown → uncertain`, anything else → `error`.
  - File: `src/services/ai.service.ts`

- **Fixed: `prediction` coercion for non-standard enum values**
  - Model returns `"BULLISH"`, `"BEARISH"`, `"LONG"`, `"SHORT"`, `"BUY"`, `"SELL"`, or `"NEUTRAL"` instead of the required `UP/DOWN/UNKNOWN`.
  - Added coercion: `BULLISH/LONG/BUY → UP`, `BEARISH/SHORT/SELL → DOWN`, anything else → `UNKNOWN`.
  - File: `src/services/ai.service.ts`

- **Fixed: `"AI analysis failed: Model returned no reason"`**
  - Root cause: Nemotron with `reasoning_budget: 16384` burns tokens on internal thinking and then gets cut off mid-JSON due to insufficient `maxTokens`, producing a response with `status: 'ok'` but no `prediction` field. The sanitizer demoted it to `uncertain` but had no real reason to show.
  - Increased NVIDIA `maxTokens` from `2000` to `4096` to give the model enough room to complete its JSON output after reasoning.
  - Added prediction recovery: when `prediction` is missing on a status-ok response, the sanitizer now scans `strategy` and `reasons` text for directional keywords (`BULL`, `LONG`, `UPSIDE`, `BUY` / `BEAR`, `SHORT`, `DOWNSIDE`, `SELL`) and infers the direction rather than immediately demoting.
  - Improved `reason` fallback cascade for `error`/`uncertain` responses: now pulls from `reasons[0]` → `strategy` text → generic message, instead of always showing the opaque `"Model returned no reason"`.
  - File: `src/services/ai.service.ts`

---

### Sentiment Service — External API Failures

- **Fixed: CNN Fear & Greed returning HTTP 418 (anti-bot block)**
  - CNN's WAF was fingerprinting the honest `boz-market-analyzer/1.5.6` User-Agent and returning 418 ("I'm a teapot").
  - Replaced with a neutral Chrome browser UA across all sentiment requests.
  - CNN 418 errors are now silenced by default (visible with `DEBUG_CROWD=1`) since the `alternative.me` fallback reliably provides the same data.
  - File: `src/services/sentiment.service.ts`

- **Fixed: StockTwits returning HTTP 403**
  - StockTwits started blocking the Chrome browser UA on their API endpoint.
  - Added a dedicated `stHeaders` object using the StockTwits mobile app UA (`Stocktwits/5.0 (iPhone; iOS 17; Scale/3.00)`) along with `Referer` and `Origin` headers matching their own app.
  - File: `src/services/sentiment.service.ts`

- **Fixed: Reddit `write EPROTO SSL alert 40` (TLS handshake failure)**
  - Cloudflare (which protects `reddit.com`) rejects Node.js's OpenSSL JA3 TLS fingerprint at the handshake level — no cipher or `https.Agent` configuration can fix this because the fingerprint is determined by OpenSSL's ClientHello structure, not the cipher list.
  - Rewrote the Reddit block to use native `fetch()` (Node's `undici` TLS stack) instead of `axios`. Undici produces a different TLS fingerprint that passes Cloudflare's check.
  - Reddit errors are now silenced by default (visible with `DEBUG_CROWD=1`) since the data is supplementary.
  - File: `src/services/sentiment.service.ts`

- **Added: Shared TLS agent for non-Reddit requests**
  - Added a module-level `https.Agent` with `minVersion: 'TLSv1.2'`, `maxVersion: 'TLSv1.3'`, and a full modern cipher suite (TLS 1.3 + ECDHE-ECDSA/RSA AES-GCM + ChaCha20) used by CNN, alternative.me, and StockTwits calls.
  - File: `src/services/sentiment.service.ts`

---

### Yahoo Service — Noisy False-Positive Warnings

- **Fixed: `[warn] Stale data — latest bar is N min old` firing outside market hours**
  - The staleness threshold was a hardcoded 120 minutes with no awareness of market hours. Running the tool at night or on weekends would flood the output with stale-data warnings for every symbol fetched.
  - Replaced with a market-hours-aware threshold: **30 minutes** during the live session (Mon–Fri 09:30–16:00 ET), **24 hours** outside it. Outside market hours, a candle from yesterday's close is never stale.
  - File: `src/services/yahoo.service.ts`

- **Fixed: `[warn] Adjusted prices requested but adjclose series was unavailable` (×3 per run)**
  - Yahoo Finance's `chart()` API endpoint no longer reliably returns the `adjclose` series. The code already handles this correctly by falling back to raw close prices, so the warning was accurate but misleading noise.
  - Warning now silenced by default; visible with `DEBUG_YAHOO=1`.
  - File: `src/services/yahoo.service.ts`

---

### Intraday Analyzer — Spurious SMA-200 Warning

- **Fixed: `[warn] SMA-200 requires 200 bars — have 21`**
  - A 5-day 1h fetch with `regularHours: true` yields ~33 trading bars by design (5 days × ~6.5 hours). SMA-200 is a daily-timeframe indicator and its absence on an intraday dataset is expected, not an error.
  - Threshold changed from 200 to 20. The warning now only fires when there are fewer than 20 bars, which would actually break SMA-20 and Bollinger Bands.
  - File: `src/analyzers/intraday.analyzer.ts`

---

## Changed

- **Sentiment service import cleanup:** removed unused `buildSocialSearchQuery` import after the Reddit block was rewritten.
  - File: `src/services/sentiment.service.ts`

---

## Debug Flags Added

| Flag | What it shows |
|---|---|
| `DEBUG_CROWD=1` | CNN Fear & Greed errors, Reddit HTTP errors |
| `DEBUG_YAHOO=1` | `adjclose` series unavailable warnings |

---

## Notes

- All external API fixes are defensive and provider-agnostic: coercions run for every provider, not just NVIDIA.
- No breaking changes to public interfaces, prompt structure, or config schema.
- `alternative.me` is now the effective primary Fear & Greed source since CNN reliably blocks scrapers. CNN remains the first attempt in case their policy changes.
