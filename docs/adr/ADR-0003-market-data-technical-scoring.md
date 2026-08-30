# ADR-0003: Aggregate Market Data into Deterministic Technical Scoring

## Status

Accepted

## Context

BOZ must produce useful market context even when an LLM is unavailable and must ground AI-generated commentary in observable data. The product requires quotes, candles, indicators, trend and risk signals, macro proxies, and news sentiment for dashboard and ticker-analysis workflows.

The current code retrieves market data predominantly from Yahoo Finance, calculates indicators locally, and combines them through analyzers such as `ChartAnalyzer`, `DashboardAnalysisService`, and intraday and long-term analysis routes. The result is then supplied to the user interface and, where applicable, to an LLM.

## Decision (What was done)

BOZ uses external market data as input to deterministic TypeScript analysis. It calculates technical indicators and heuristic scores before invoking generative models. Dashboard aggregation combines ticker data with macro symbols, sentiment, and news. LLM prompts receive structured analysis rather than being asked to invent market facts without any tool output.

The market-data layer uses retry and timeout behavior and returns normalized application-facing objects. The deterministic layer remains usable in offline or limited-provider modes where generative synthesis is unavailable.

## Better Way / Alternatives Considered (What could be done better)

Relying entirely on an LLM would be simpler but would make results non-reproducible and prone to fabricated prices or indicators. Buying a professional market-data feed could improve guarantees but would add licensing cost and credential management. Computing every view directly inside route handlers would avoid abstractions but make formulas inconsistent and difficult to test.

The retained approach should be formalized around a `MarketDataPort`, explicit data provenance, quote timestamps, stale-data rules, request coalescing, bounded caches, and typed partial-failure results. Technical concepts must be named accurately: current extrema labeled as "nearest" support and resistance should either use an actual proximity/pivot algorithm or be renamed. Heuristic confidence levels and BUY/SELL classifications require backtesting and calibration before they are represented as decision-quality signals.

Long-term analysis also needs fundamental-data adapters. Technical, macro, and sentiment inputs cannot support claims about valuation, revenue, margins, or business moat on their own.

## Consequences

Deterministic preprocessing improves repeatability, offline degradation, testability, and LLM grounding. It creates a domain layer that can be audited independently of provider output.

Yahoo and public datasets offer limited service guarantees, and current repeated fetches can be slow or rate-limited. Heuristic labels may convey more certainty than the evidence warrants. Adding provenance, caches, provider contracts, and calibrated scoring increases implementation effort but is necessary for a professional research product.
