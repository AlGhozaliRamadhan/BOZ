# BOZ Codebase Audit

> Audit snapshot: commit `678ed8b`, 2026-08-30. Scope: tracked source, tests, documentation, package/build configuration, Docker configuration, and GitHub workflows. Local secret values and generated runtime data were deliberately not inspected.

> Remediation update: the first post-audit hardening slice removed credential disclosure/browser persistence and the TradingView DOM XSS, unified atomic settings storage, added custom-provider egress controls, aligned the Docker runtime, and added regression tests. Findings below retain their original evidence and include explicit remediation status.

## Executive Assessment

BOZ is a credible local market-research prototype with meaningful engineering strengths: strict TypeScript is enabled, market/indicator concerns are partially modularized, model JSON is schema-validated, untrusted HTML is sanitized in the main Markdown renderer, external calls generally use timeouts, the launcher has lifecycle tests, package sanitization removes traced environment files, and `npm audit` reports no known dependency vulnerabilities.

It is not production-ready as an internet-facing or multi-user service. The first hardening slice corrected the direct credential, settings-persistence, custom-egress, and chart-injection defects. The most important remaining weaknesses are the absence of an authenticated network mode, process-global request state, persistent prompt-injection paths, unvalidated route/tool contracts outside settings, unbounded expensive workflows, and low coverage of the actual decision engine. These are architectural issues; polishing components or adding more prompts will not resolve them.

### Goal check

| Product goal | Status | Audit conclusion |
| --- | --- | --- |
| Unified market dashboard | Implemented | Composite quote, technical, macro, sentiment, news, and trade-plan response exists and is rendered |
| Multi-timeframe technical analysis | Implemented with caveats | Indicators and pattern heuristics execute, but important scoring/pattern logic is untested and not empirically calibrated |
| Risk-aware trade levels | Implemented as heuristics | Deterministic plans exist; no backtest or portfolio-risk model establishes predictive validity |
| Omni-agent research | Implemented | Tool loop, evidence ledger, model fallback, and SSE streaming exist; orchestration is large, expensive, and prompt-injection-sensitive |
| News and crowd intelligence | Partially implemented | Multiple fallbacks exist, but provider reliability, source attribution, and stale/partial data handling are inconsistent |
| IDX momentum scanner | Implemented with a single-source dependency | Scans and ranks candidates, but the declared static universe fallback is missing |
| Flexible AI backends | Implemented with constrained custom egress | Four provider modes exist; custom endpoint discovery and LLM calls now enforce loopback-or-public-HTTPS destination policy |
| Session memory | Partially implemented | Browser chat history and JSON memory exist; the tested session-log service is not used by runtime code |
| Professional long-term company research | Not fully achieved | Long-term prompts request moat, revenue, and valuation conclusions without a structured fundamentals pipeline |
| Safe local npm deployment | Implemented with caveats | Launcher binds to loopback; settings reads/writes use the same per-user configuration path and atomic repository |
| Safe hosted/Docker deployment | Not achieved | Compose now publishes on host loopback, but no authenticated, rate-limited, multi-user mode exists |

## Validation Evidence

| Check | Result |
| --- | --- |
| `node --version` | `v26.2.0` on audit host |
| `npm --version` | `11.17.0` |
| `npm run typecheck` | Passed |
| `npm audit --json` | Passed; 0 total known vulnerabilities across 373 dependencies |
| Baseline `npm test` | Failed on the audit host: 4 timeouts, 44 passing tests |
| Failed test files in isolation | Passed individually |
| `npx vitest run --coverage --maxWorkers=1` | 48/48 passed; 33.08% statements and 34.26% lines for imported files |
| Post-hardening `npm test` | Passed: 82/82 tests across 22 files using the canonical serialized-worker configuration |
| Post-hardening focused hardening tests | Passed: 37/37 tests across settings, persistence, egress policy, environment path, chart-symbol, cache-path, and readiness-polling suites |
| Post-hardening coverage | 79/79 deterministic tests passed; 36.63% statements, 29.05% branches, 46.71% functions, 37.61% lines. The two real Next.js process smoke suites are intentionally excluded from instrumentation and remain in `npm test`. |
| Baseline package dry run | 19.0 MB compressed, 72.6 MB unpacked, 4,066 entries in the original audited generated output |
| Post-hardening package dry run | 18.96 MB compressed, 72.28 MB unpacked, 4,065 entries; no IDX cache or TypeScript build-info file, and `dist/.env.build` is the only dotenv-named file |

The original serialized result was diagnostic rather than a substitute for the required gate. The canonical command now passes deterministically, but risk-critical coverage remains insufficient.

## Critical and High-Priority Findings

### AUD-001 — Credential disclosure and duplicate plaintext browser storage

**Severity:** Critical for any network-accessible deployment; High for localhost-only use.

**Remediation status:** Resolved for the supported local-first boundary. Settings responses now contain presence flags only, credential inputs are write-only, the legacy browser key ring is deleted on settings UI mount, and regression tests assert that secret values never appear in the response.

`src/app/api/settings/route.ts` returns full NVIDIA, GitHub, and custom provider credentials in the GET payload. `src/app/components/ui/SettingsModal.tsx` copies those values into component state and persists a multi-key ring to `localStorage` as `boz_provider_keys`.

This violates least privilege and creates several exposure paths:

- any unauthenticated caller can retrieve keys when the service is reachable;
- any same-origin XSS can read the entire browser key ring;
- third-party scripts loaded by the application increase the impact of a compromised dependency or content source; and
- deleting a key from the UI does not provide a trustworthy secret lifecycle across the server `.env` and browser copies.

**Required correction:** Make settings reads redacted and write-only for secrets. Store keys only in a server-side secret repository with restrictive permissions. Remove credentials from browser storage and add migration code that deletes the legacy key ring.

### AUD-002 — Unauthenticated SSRF-capable configuration and expensive public endpoints

**Severity:** Critical for hosted/Docker use.

**Remediation status:** Partially mitigated. Custom-provider discovery and LLM requests now accept only explicit loopback HTTP or DNS-validated public HTTPS destinations, reject credentials/query/fragment/private/reserved addresses and redirects, cap model-list responses, and Compose publishes only on host loopback. Authentication, authorization, quotas, general expensive-endpoint rate limits, and connection-level DNS pinning remain open.

The settings PUT accepts an arbitrary custom provider URL. The custom-model and connection-test routes then issue server-side requests to `${endpoint}/models`. There is no authentication, CSRF protection, origin enforcement, redirect validation, or private-network block. An attacker who can reach the Docker-exposed service can aim requests at loopback, private services, link-local addresses, or cloud metadata endpoints.

The same unauthenticated surface exposes LLM calls, deep web fetches, dashboard aggregation, and exhaustive IDX scans, enabling cost and resource exhaustion.

**Required correction:** Until an authenticated deployment mode exists, enforce loopback binding and fail startup when an unsafe bind is requested. For hosted mode, add authentication/authorization, CSRF protection, quotas, concurrency limits, and an outbound URL policy that validates DNS results and every redirect.

### AUD-003 — DOM XSS in TradingView attribution compounds credential exposure

**Severity:** High.

**Remediation status:** Resolved. TradingView symbols now pass a strict character allowlist, hostile inputs fall back safely, attribution is constructed with DOM nodes and `textContent`, and markup-bearing regression cases are covered.

`src/app/components/ui/TradingViewChart.tsx` accepts any value containing `:` as an already-prefixed symbol and later interpolates that symbol into `credit.innerHTML`. A crafted dashboard route can therefore place markup in an HTML sink. The same origin stores API credentials and chat history in `localStorage`, magnifying the impact.

**Required correction:** Never build the attribution with `innerHTML`. Construct the anchor and text nodes through DOM APIs or JSX, validate exchange and ticker with a strict allow-list, and add a regression test with HTML-bearing route input. Remove browser-stored credentials independently.

### AUD-004 — Process-global mutable state is used as request context

**Severity:** High.

`src/config/config.ts` holds a mutable active ticker, model, provider, endpoint, and risk mode. Market routes call `config.setTicker(...)`; the macro and sentiment services later read `config.ticker`. The chat engine calls `config.setAIModel(...)` for a request override. Concurrent requests can therefore mix symbols, models, risk modes, and results across users or browser tabs.

This is a correctness and isolation flaw even before authentication is introduced.

**Required correction:** Split immutable startup configuration from request-scoped context. Pass `symbol`, provider/model selection, and risk mode explicitly through use-case inputs. A per-user preference repository may provide defaults, but it must not become the active request object.

### AUD-005 — Settings persistence contract is broken and filesystem writes are unsafe

**Severity:** High.

**Remediation status:** Resolved for the local dotenv repository. Launcher and settings routes now share `configEnvPath()`, `BOZ_CONFIG_DIR` is honored, writes are serialized and atomically replaced, and restrictive directory/file modes are requested where the platform supports them.

The launcher reads `configEnvPath()` under `~/.boz/.env`, but the settings route writes `path.resolve(process.cwd(), '.env')`. An installed `boz` process inherits the directory from which the user launched it, so settings can be lost, written into an unrelated project, or fail on an unwritable directory.

The route uses synchronous, non-atomic read/modify/write operations. Concurrent PUT requests can lose updates or corrupt the file. File permissions are not explicitly restricted.

**Required correction:** Use one injected configuration repository based on `configEnvPath()`, atomic temp-file replacement, serialized writes, restrictive permissions, and typed update methods. Add an integration test that starts the packaged app from an arbitrary working directory and verifies persistence across restart.

### AUD-006 — Persistent prompt-injection path through memory and external content

**Severity:** High.

Search pages, RSS content, social posts, and model output enter chat tool messages as plain text. The model can call `update_memory`, which persists unbounded text to `memory.json`; that text is injected into the next chat system prompt as `USER FACTS` or `USER PREFERENCES`.

A malicious page or feed can therefore attempt to persuade the model to save instructions that survive future sessions. The current evidence ledger labels data quality but does not establish an instruction/data boundary.

**Required correction:** Remove autonomous persistent writes. Require an explicit user confirmation and structured memory schema, cap entry count/length, escape or delimit memory as untrusted data, retain provenance, and prevent tool-fetched text from being promoted into instructions.

### AUD-007 — Public request contracts are cast, not validated

**Severity:** High.

**Remediation status:** Partially mitigated. The settings route now rejects non-object/unknown fields, invalid enums, oversized or control-bearing strings, malformed model lists, unsafe URLs, and malformed JSON. Other public routes and tool inputs still require schemas and size limits.

`parseBody<T>` only casts `request.json()` to `T`. Verdict routes accept client-supplied nested market data as `any`; settings, chat history, model IDs, search queries, and tool arguments have no complete runtime schema. Internal error messages are frequently returned directly to clients.

Malformed numeric values can produce `NaN`, `Infinity`, negative targets, excessive prompt sizes, or provider-specific failures. Large histories and queries can consume memory and paid model tokens.

**Required correction:** Define Ajv or equivalent schemas for every route and SSE event, use maximum lengths/counts, validate finite numeric ranges, return stable error codes, and log redacted internal errors separately.

### AUD-008 — Long-term “fundamental” conclusions are not grounded in fundamental data

**Severity:** High product-integrity risk.

The long-term system prompt asks the LLM to discuss business model vision, moat, revenue catalysts, valuation expansion, and an earnings roadmap. The dedicated long-term routes supply technical indicators, 52-week positioning, macro context, crowd sentiment, and chart patterns, but no financial statements, earnings estimates, balance-sheet quality, valuation history, or verified company profile.

The chat path often fetches news, but the dedicated analysis route can manufacture a professional-sounding fundamental thesis from absent evidence.

**Required correction:** Either narrow the output to technical/macro research or add a typed fundamentals pipeline with source timestamps and provenance. The output schema should distinguish observed facts, model interpretation, and unsupported/unknown fields.

### AUD-009 — No cancellation, quota, or bounded orchestration for costly work

**Severity:** High for hosted use; Medium locally.

The chat loop permits 15 tool rounds and up to five model passes. Tool calls run concurrently, and simulated specialist calls are additional LLM requests. The SSE route does not propagate client disconnect cancellation into provider calls. IDX deep scans and page extraction are similarly expensive.

**Required correction:** Introduce an execution budget with maximum wall time, provider calls, tools, fetched bytes, and tokens. Propagate `AbortSignal`, stop work on disconnect, rate-limit by authenticated principal, and emit a structured partial-result event when the budget is exhausted.

### AUD-010 — The required test gate is flaky and core behavior is mostly uncovered

**Severity:** High release-confidence risk.

**Remediation status:** Partially mitigated. The canonical command passed 82/82 tests after adding focused security, cache, and readiness suites. Port-owning process suites are serialized, and coverage excludes those two real Next.js smoke suites to avoid instrumenting child compilation. Coverage of the decision engine, orchestration, and other route families remains below a professional release threshold.

At the baseline snapshot, the default test command timed out when launcher and network-mocked integration files ran in parallel, while a serialized run passed. Baseline coverage was concentrated in utilities and legacy prompt/session modules:

- chart analyzer: 0%;
- macro service: 0%;
- Yahoo service: approximately 4% lines;
- LLM adapter: approximately 11.5% lines;
- route tests only assert missing-ticker errors for two data routes; and
- the chat engine, settings route, dashboard analysis, IDX scanner, React pages, and security-sensitive flows were absent from the measured report.

**Required correction:** Separate unit, integration, and launcher/E2E projects; serialize only port-owning integration tests; use ephemeral ports; mock Next compilation where process semantics—not compilation—are under test; and enforce coverage on risk-critical modules rather than inflating coverage with dead code.

## Medium-Priority Findings

### AUD-011 — Aggregate market pipeline performs redundant work and can overlap

The dashboard polls every 30 seconds. One aggregate call fetches daily candles and then asks `MacroService` to fetch the same asset plus SPY, QQQ, VIX, TNX, and XLK. News and sentiment perform additional external calls. If a run takes longer than 30 seconds, the client can start another request because there is no abort or in-flight guard.

Introduce request coalescing, symbol/interval caches, freshness-aware TTLs, partial-result semantics, and client cancellation. Separate fast quote refresh from slow macro/news refresh.

### AUD-012 — Failure semantics are inconsistent and often hide operational defects

Services alternate between throwing, returning `[]`, returning `null`, and silently swallowing errors. Route handlers then convert many internal failures into HTTP 500 responses with raw error messages. `Promise.all` makes some analysis routes fail if any optional macro or sentiment source fails, while the dashboard route explicitly degrades those dependencies.

Use a typed result model with source, freshness, status, and error category. Reserve exceptions for unexpected failures and use `Promise.allSettled` for optional enrichments.

### AUD-013 — IDX universe has no real fallback and writes beside bundled source

**Remediation status:** Partially mitigated. Mutable universe cache now uses the per-user BOZ directory, writes through atomic replacement, and is no longer sourced from the code tree. The declared reviewed static fallback is still absent.

`IdxUniverseService` documents a fallback to `src/data/idx-universe.json`, but that file is absent. Its cache path is derived relative to the module, causing a generated cache to be traced into the standalone package. A failed GitHub dataset fetch can therefore return an empty universe, and published packages can ship stale machine-generated scan data.

Commit a reviewed static universe fixture or move universe acquisition behind a durable provider/cache abstraction. Store mutable cache under the per-user data directory, not beside code.

### AUD-014 — Pattern and trade-plan names overstate what the algorithms calculate

`ChartAnalyzer.nearest_support` is the minimum low of up to 120 candles and `nearest_resistance` is the maximum high; neither is necessarily the nearest actionable level. Pattern “HIGH” confidence is assigned from fixed geometric thresholds without trend, volume, timeframe, or historical precision/recall calibration. Setup-specific IDX scans forcibly relabel the top relative matches as BUY even if the entire set is weak.

Rename these outputs to match their semantics or implement true pivot/level ranking. Add invariant tests and offline backtests before exposing “confidence” as an empirical term.

### AUD-015 — Package and deployment contracts are internally inconsistent

**Remediation status:** Partially mitigated. README/runtime badges and Docker now use the declared Node.js support line, Compose publishes to host loopback, and mutable IDX cache moved out of the traced source tree. Package duplication and artifact-size enforcement remain open.

At the baseline snapshot:

- README says Node.js 18+, `package.json` requires Node 22.22.2/24.15.0/26+, and Docker builds with Node 20.
- The package dry run contains duplicate static assets and generated IDX cache data.
- The audited package is 72.6 MB unpacked with 4,066 entries.
- `dist/tsconfig.tsbuildinfo` was present in the dry-run inventory despite ignore intent.
- Docker exposes `0.0.0.0`, while the application has a localhost-only security design.

Align the supported runtime, use a compatible Docker base, inventory package contents in CI, reject generated/local data, and document one support matrix.

### AUD-016 — Release workflow does not implement all canonical gates

The publish workflow runs tests, type checking, and the package build, but it does not run the two required npm audit commands or built-launcher version verification specified in `AGENTS.md`. It is triggered on every push to `main`, tags, releases, and manual dispatch; manual dispatch forces a publish attempt even when the same version already exists.

Make release intent explicit, run every canonical gate from a clean commit, inventory and inspect archives, and publish only from the reviewed release PR/tag path.

### AUD-017 — Third-party browser assets lack a documented content-security policy

The layout loads Font Awesome from a CDN and the chart component injects TradingView's external script. No application-level CSP or other security headers are configured. This is especially concerning while secrets live in browser storage.

Prefer self-hosted pinned assets where practical. Add a restrictive nonce/hash-based CSP, frame policy, referrer policy, permissions policy, and documented exceptions for TradingView.

## Maintainability and Naming Review

### Structural issues

The largest source files combine unrelated responsibilities:

| File | Approximate size | Mixed responsibilities |
| --- | ---: | --- |
| `src/app/api/chat/chat.engine.ts` | 1,495 lines | Prompt policy, tool registry, tool execution, model fallback, fact extraction, multi-pass orchestration, SSE-facing events |
| `src/app/dashboard/[ticker]/page.tsx` | 1,028 lines | API mapping, polling, search, local preferences, view state, and full dashboard presentation |
| `src/app/components/ui/SettingsModal.tsx` | 823 lines | Provider catalog, credential store, endpoint discovery, settings mutations, connection tests, and modal UI |
| `src/app/chat/ChatComponent.tsx` | 738 lines | Session repository, SSE parser, command routing, Markdown rendering, timeline state, and chat UI |
| `src/shared/dashboard-analysis.ts` | 728 lines | Asset identity, sentiment scoring, indicators-to-signals, scoring, planning, formatting, and narrative insights |
| `src/services/news/news.fetch.service.ts` | 608 lines | Provider registry, retries, disk cache, parsing, normalization, categorization, and sentiment |

These modules violate single-responsibility and make focused tests difficult. Refactor by extracting contracts and pure functions first, then adapters and orchestration. Avoid a cosmetic file split that leaves cyclic dependencies.

### Confusing or amateur naming and professional alternatives

| Current name | Problem | Recommended target name |
| --- | --- | --- |
| `src/types/types.ts` | Tautological and domain-ambiguous | `src/domain/market/market-types.ts` |
| `config` / `config.ts` | Mixes immutable config, runtime selection, and request state | `applicationConfig`, `ProviderRegistry`, `RequestAnalysisContext` |
| `YahooService` | Hides that it is an external market-data adapter | `YahooMarketDataClient` |
| `AIService` | Too broad; actually produces a structured market verdict | `MarketVerdictService` |
| `LLMAdapter` | Acronym/style inconsistency and multiple provider gateway responsibilities | `LlmGateway` plus provider-specific clients |
| `WebChatEngine` | “Engine” is vague and tied to transport | `ResearchOrchestrator` |
| `NewsFetchService` | Describes mechanics, not capability | `MarketNewsAggregator` |
| `NewsService` | Overlaps with `NewsFetchService` | `TickerNewsService` |
| `MemoryService` | Actually a filesystem repository | `UserMemoryRepository` |
| `SessionLogService` | Actually a JSON research-session repository | `ResearchSessionRepository` |
| `ChartAnalyzer` | Includes candlesticks and heuristic structures | `TechnicalPatternAnalyzer` |
| `shared/` | Becomes a dumping ground across layers | split into `domain/`, `features/`, and `infrastructure/` |
| `last`, `q`, `n`, `data`, `result` | Context-poor in long orchestration functions | `latestCandle`, `quoteResponse`, `newsItem`, `analysisResponse` |
| `patterns_found`, `fib_levels` | Internal snake_case conflicts with TypeScript conventions | `detectedPatterns`, `fibonacciLevels` |
| `news.fetch.service.ts` | Dotted role naming is inconsistent with feature names | `market-news-aggregator.ts` |
| `longterm` | Less readable compound in routes/types | retain URL for compatibility; use `longTerm` internally |

### Dead or disconnected code

- `src/shared/prompts.ts` is only exercised by tests; runtime routes use separate private prompt builders.
- `src/services/core/session.log.service.ts` is tested but not imported by runtime code.
- `src/app/lib/hooks.ts` has no consumers and its quote contract does not match the route payload.
- `src/utils/retry.util.ts` is unused while services implement separate retry loops.
- `src/utils/ping.ts` is not wired to a package script or launcher command.

Delete these modules if obsolete or wire them in as the single implementation. Tests for disconnected code create false confidence.

## SOLID and Clean-Architecture Assessment

| Principle | Current state | Direction |
| --- | --- | --- |
| Single responsibility | Frequently violated in chat, settings, dashboard, and news modules | Extract use cases, repositories, provider clients, and pure presenters |
| Open/closed | Provider branches are repeated across config, adapter, UI, and settings | Use a provider registry with a stable interface and per-provider capability metadata |
| Liskov substitution | No explicit adapter interfaces; fallback behaviors differ materially | Define contracts for text, streaming, tools, models, timeouts, and errors |
| Interface segregation | UI and routes depend on broad composite payloads and `any` | Publish narrow feature DTOs and discriminated result types |
| Dependency inversion | Routes construct concrete services and domain code reads global config | Compose dependencies at bootstrap and inject interfaces into use cases |

## Recommended Refactor Sequence

1. **Complete the trust boundary:** direct secret exposure, chart XSS, settings writes, default binding, and custom egress are hardened; add an explicit authenticated network mode, CSP/security headers, and rate limits before supporting remote access.
2. **Make requests isolated:** replace mutable ticker/model globals with explicit request context; retain the new atomic configuration repository only for persisted defaults.
3. **Validate contracts and budgets:** add schemas, stable errors, size limits, cancellation, rate limits, and orchestration budgets.
4. **Ground the product:** either add a real fundamentals pipeline or narrow long-term claims; add provenance/freshness to every thesis input.
5. **Build confidence:** the required gate now passes and settings/security tests exist; split test projects and cover dashboard scoring, chart patterns, chat orchestration, and IDX behavior.
6. **Then modularize:** move toward the target feature/domain/infrastructure structure in `ARCHITECTURE.md`, removing dead code and duplicated prompt/route implementations during each tested slice.

Do not begin with a repository-wide rename. The security and correctness boundaries deliver materially more value and provide seams that make later renaming safe.
