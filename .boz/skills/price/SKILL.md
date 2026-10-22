---
name: price
description: Quick live price check for any asset [ticker]
title: Price
icon: fa-tag
arg: ticker
triggers: ["/price"]
---

# Price — live quote

## When to use

Message starts with `/price <TICKER>` (e.g. `/price NVDA` or `/price BBCA.JK`).

## Must do

1. Call `fetch_price(symbol_or_name)` for the requested asset. No dashboard, no web search unless the price tool returns nothing.
2. A company name instead of a symbol is fine; resolve it and say which listing was used. Never present one listing's price as the only truth when the name is ambiguous across exchanges or market states.
3. If the tool indicates a market state such as pre-market, after-hours, or a halt, say so with the quote instead of presenting a stale price as live.
4. IDX tickers price in IDR and trade Jakarta hours; mention the timezone only when it explains a mismatch.
5. If the tool returns nothing meaningful, say so in one line and stop. A quote is this lens's whole job: do not silently start a full analysis. If the message clearly asks for one, name the lens it belongs to in one line and do not run it here.

## Output

- One compact line: symbol, live price, day change. No emojis, no filler openers.
