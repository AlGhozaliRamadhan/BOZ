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

## IDX market judgment

- The score is a screen; size and liquidity decide feasibility. Blue chips fill near quoted prices; micro-caps run on thin books with wide effective spreads, where the printed move and a fillable price are different things. A top-ranked rebound on a micro-cap with negligible volume is not a trade, whatever its score — rank it below the liquid name that scored lower and say why.
- "Oversold" becomes a rebound case only with a stabilization trigger in the data: a close that stops making new lows, a level that holds for a session. A stock still printing new lows is a falling price, not a setup, however stretched its 52w position reads.
- "Breakout" stays a candidate until volume expands beyond the base; a break on thin volume hands the position straight back to sellers.
- Momentum needs participation, not just price. The volume ratio is what confirms a setup; a move drifting without volume behind it is drift, not signal.
- One tape moves the whole board. Foreign-flow direction and rupiah/BI-rate stress lift or press most IDX names at once, and a good single-name setup dies with the tape. Earnings season and index events (LQ45-type reshuffles, dividend dates) distort short-term moves with flow that is not signal. Read where foreign flow and the rupiah actually stand from fetch_news / web_search before leaning on them, never from memory.
- Execution honesty. A stop at an illiquid level is not a stop — it is an order you may not get filled at, and entries near thin levels share the problem. If you doubt the position can be put on and taken off near the planned numbers, say wait, and name what would make it executable: bids holding, volume ratio expanding, the spread behaving. Plan numbers you present come only from risk_calc.

## Output

- Ranked picks with score, setup, trigger, stop, and invalidation. No emojis, no filler openers.
- Say in market terms why the top pick leads — which setup it is, whether participation carries it — not only that its score is highest.
- If the screener's favorites look better in data than they would in a live book, rank what is actually executable and say so plainly.
