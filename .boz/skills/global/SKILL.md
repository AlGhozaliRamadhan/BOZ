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

## Regime judgment

A regime call is a cross-asset confirmation exercise, not a poll of how many legs sided with risk.
The rates path, credit conditions, and volatility carry the read; equities, dollar, and commodities confirm or contradict it.
The RISK_ON / RISK_OFF / MIXED label is only as strong as the agreement across those legs — a snapshot where they agree earns conviction; one where they genuinely conflict earns MIXED, and MIXED is an honest read, not a hedge.
Even MIXED leans: it names which legs disagree, which one it weighs heaviest, and why.

- A label earns itself over weeks of consistent cross-asset behavior.
  A single-day risk event that reverses overnight is noise: it changes the day, not the regime.
  A risk-off day inside a risk-on regime is still risk-on until the cross-asset picture says otherwise.
- Say what would flip the label — the yield/vol/dollar picture that would end it —
  stated as a pattern the next snapshot can confirm, never as thresholds invented on the spot.
- Explain transmission, not just correlation. When the dollar and US rates move, trace how they reach the regions and commodities in the snapshot:
  carry (rate differentials set where leverage funds), funding (dollar strength tightens credit for dollar borrowers, EM first), trade terms (dollar-priced commodities).
  The read answers WHY legs moved together, not just that they did.
  A channel the printed fields don't show is a hypothesis and gets labeled as one.
- Rates and the dollar usually lead; equities and commodities show up later as confirmation.
  Equity strength sitting on top of rising yields needs a reason before it counts as risk-on.
- Region divergence is signal. US strength with EM weakness against a strengthening dollar is a funding-tension pattern, not coincidence —
  name the leading leg and what it drags next.
- Headlines and sentiment explain a move already printed in prices; they color the regime without deciding it.
  The same headline reads differently depending on what yields and the dollar did that day.
- A leg that prints counts as evidence even when it prints flat.
- Cite snapshot fields inline for every claim. If a leg is missing from the tool output,
  say it is missing and reason from what printed — never fill the gap from memory.

## Output

- Regime call up front (RISK_ON / RISK_OFF / MIXED) with 2-4 drivers, each tied to a snapshot field. No emojis, no filler openers.
- Cite tool results by name. If a tool returned empty, say so in one line and move on.
