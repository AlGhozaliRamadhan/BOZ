---
name: sentiment
description: Crowd sentiment check — Fear & Greed + StockTwits pulse
title: Sentiment
icon: fa-face-smile
triggers: ["/sentiment"]
---

# Sentiment — crowd pulse

## When to use

Message starts with `/sentiment` (optional ticker after it).

## Must do

1. Call `fetch_sentiment()` for the Fear & Greed + StockTwits crowd snapshot.
2. Treat crowd data as observation, not forecast: StockTwits >70% bullish is contrarian caution (needs price/volume confirmation), <30% is potential panic (needs stabilization trigger). Fear & Greed >75 / <25 only adjusts confidence, never decides alone.

## Output

- Compact sentiment readout with contrarian read. No emojis, no filler openers.
