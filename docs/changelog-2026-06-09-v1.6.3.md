# Changelog — v1.6.3 (2026-06-09)

---

## [1.6.3] – 2026-06-09

### Fixed (Critical)
- **`LLMAdapter.stripThinking`** — Fixed a bug where any AI response containing the letter `D` (e.g. "DOWN", "USD", "DeepSeek") had its prefix destroyed. Now correctly strips `</thinking>` and `` tags instead of a literal character check.

- **`CLI.handleLine`** — Added `try...catch...finally` around command handlers so raw-mode terminal state is always restored on error. Previously, any thrown error would leave the terminal frozen and unresponsive.

- **`NewsIntelAgent.finish`** — Now enforces the `audit_claims` rule: if `audit_claims` has not been called during the session, the `finish` tool returns a blocking error instead of completing the run.

- **`InteractiveChatAgent.run()`** — Inner tool-call loop is now capped at 20 rounds to prevent infinite tool cascades from a misbehaving model.

- **`InteractiveChatAgent` retry logic** — All AI calls in the chat agent now route through `BaseAgent.callAIWithRetry` (exponential backoff for 429/5xx), preventing crashes on transient API failures.

- **`InteractiveChatAgent` reasoning** — `generateStepThought` step labels are now clearly marked as system-generated, avoiding user confusion with actual AI reasoning.

### Fixed (High-Priority)
- **`extractJson` nested JSON** — Hardened JSON extraction with bracket-depth parsing so responses with nested objects or multiple JSON blobs no longer get corrupted.

- **`hasFetchPrice` shadowing** — Changed from `startsWith('fetch_price')` to exact match `=== 'fetch_price'`, preventing `fetch_price_momentum` from incorrectly satisfying the grounding rule.

### Development / Maintenance
- Added `CLAUDE.md` and `docs/improvements.md` to `.gitignore` so they are not accidentally committed to the repository.
