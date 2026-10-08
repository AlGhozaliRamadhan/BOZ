---
name: global
description: Global market outlook — equities, bonds/rates, macro regime
title: Global
icon: fa-earth-asia
triggers: ["/global"]
---

# Global — broad market outlook

## When to use

Message starts with `/global` (optional focus after it, e.g. `/global bonds vs equities`).
Also use when the request covers equities + bonds/rates + macro regimes together.

## Must do

1. Call `fetch_global_market_snapshot()` first — never substitute SPY or one ticker for a global view.
2. Assess US, developed ex-US, and emerging equities together with global bonds/credit, volatility, yield, dollar, commodities, sentiment, and headlines.
3. Call additional focused tools only when the snapshot reveals a meaningful gap or conflict.

## Output

- Regime call up front (RISK_ON / RISK_OFF / MIXED) with 2-4 drivers. No emojis, no filler openers.
- Cite tool results by name. If a tool returned empty, say so in one line and move on.
