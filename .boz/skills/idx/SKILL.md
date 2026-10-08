---
name: idx
description: Hunt IDX momentum setups — rebound, breakout, oversold [sector]
title: IDX Hunt
icon: fa-magnifying-glass-chart
triggers: ["/idx"]
---

# IDX — Indonesian momentum hunt

## When to use

Message starts with `/idx` (optional sector or setup after it, e.g. `/idx banking breakout`).
Also use when asked for IDX stocks to buy, invest, or watch.

## Must do

1. ALWAYS call `scan_indonesia_momentum`. Autonomously pick the best setup filter ("rebound", "breakout", "oversold", "momentum").
2. After the scan, call `fetch_price` on the top 2-3 BUY candidates to confirm live prices.
3. Then call `fetch_news` WITH THE SPECIFIC COMPANY NAME AND SYMBOL. If news is irrelevant, call `web_search` for deep fundamentals.
4. Do NOT just name BBCA/BBRI/TLKM from memory — those are lazy defaults.
5. Cite the score, volume ratio, and 52w range position.

## Output

- Ranked picks with score, setup, trigger, stop, and invalidation. No emojis, no filler openers.
