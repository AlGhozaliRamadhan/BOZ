---
name: price
description: Quick live price check for any asset [ticker]
title: Price
icon: fa-tag
triggers: ["/price"]
---

# Price — live quote

## When to use

Message starts with `/price <TICKER>` (e.g. `/price NVDA` or `/price BBCA.JK`).

## Must do

1. Call `fetch_price(symbol_or_name)` for the requested asset. No dashboard, no web search unless the price tool returns nothing.
2. If the tool returns empty, say so in one line and stop.

## Output

- One compact line: symbol, live price, day change. No emojis, no filler openers.
