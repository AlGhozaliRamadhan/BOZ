---
name: who
description: Company profile — who they are, disclosure depth, legitimacy, latest news [ticker]
title: Who
icon: fa-building
arg: ticker
shape: profile
triggers: ["/who"]
---

# Who — company profile

## When to use

Message starts with `/who <TICKER>` (e.g. `/who BBCA`, `/who NVDA`, `/who 7201.T`).

## Job

Answer "who is this ticker, should I trust it, and what just happened" — a research brief on the business, NOT a trade. The user is checking whether the thing behind the symbol is real, how much can actually be known about it, and what changed recently. They did not ask for an entry, a stop, or a position.

## Must do

1. Call `fetch_price(symbol)` first. It proves the symbol resolves to a live, tradable instrument and gives the venue and currency. A symbol that returns nothing is not a company you can profile — say so in one line and stop.
2. Call `fetch_ticker_dashboard(symbol)` for the quantitative baseline (price, volume, market cap, levels, correlations).
3. Call `fetch_news` AND `web_search` for the qualitative half. Search decision-relevant questions, never a duplicate of one you already ran:
   - **What they do**: segments, products, geography, and how revenue is actually earned — not the tagline.
   - **Disclosure depth**: what filings exist and how often (annual report, 10-K/20-F, quarterly), whether segments and geography are broken out, what the company itself does NOT split. Be blunt when it is thin.
   - **Legitimacy**: listing venue, size and liquidity, filing history, auditor, whether the symbol resolves consistently across sources.
   - **Latest news**: the last few material developments, with dates.
4. Legitimacy is an EVIDENCE verdict, never a vibe and never a bare reassurance. Weigh: established listing, real float and volume, a filing history you can actually see, a named auditor, consistency between sources. If the evidence is thin, absent, or contradictory, say exactly what is missing and do NOT clear it — an unresolved flag is a legitimate finding.
5. Every claim traces to a tool result. A fact you could not verify is omitted, never softened into a maybe.

## Output

Four compact sections, in this order, each one tight paragraph or a short bullet list:

- **What they do** — segments, products, geography, where the money comes from.
- **How much is knowable** — filing type and cadence, granularity of segment and geographic disclosure, and what stays opaque.
- **Legitimacy** — the verdict with the specific evidence behind it, and the gaps if any.
- **Latest news** — the few developments that matter, each with its date and source.

Close with one line on what would change this read. No trade plan, no entry/stop/targets, no likely-path table, no My take — a profile is not a recommendation.

## Style

Lead with the company in one sentence, then the sections. Scannable beats exhaustive: a reader deciding whether to dig further needs the verdict early, not a biography. Stay within the delivery word cap by cutting detail, never by dropping a section. If a section has nothing behind it, say "not disclosed" or "no recent material news" rather than padding.