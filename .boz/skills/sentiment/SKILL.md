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

1. Call `fetch_sentiment()` for the Fear & Greed index plus the StockTwits crowd snapshot; it stays the first call. Pull `fetch_ticker_dashboard` alongside, since judging the crowd takes its price and volume.

2. Crowds are early at extremes, wrong in the middle; place the reading in the move before calling it contrarian. Extreme euphoria as an uptrend turns is how crowds behave while fresh money is arriving, while the same extreme after a long run, with decaying volume, is the contrarian tell. If you can't place the reading, pull the dashboard: trend age is a price question.

3. The reading only matters next to price and volume. Bullish crowd while price stalls on shrinking volume is distribution-flavored, not expansion; bullish crowd beside rising volume and confirmed breakouts is participation that has worked so far. `bull_ratio` above 70 is contrarian caution until price and volume confirm, never an automatic buy; below 30 is potential panic until a stabilization trigger prints.

4. Be honest about the sample. The StockTwits stream is small and retail-skewed: 90% bullish on a dozen labelled messages is noise. Check `total_with_sentiment`; if the sample is thin, say so and discount the read. A blank or blocked stream is no crowd read; say that rather than manufacturing one.

5. Fear & Greed below 25 is stressed conditions, not a strong-buy signal by itself; above 75 is overheated, not a sell in itself. It's a US-wide gauge, so for one ticker it's backdrop, and it adjusts conviction only where price, volume, and location already support the call.

6. Crowd extremes are one input, not standalone evidence of direction. They resize conviction on a call other evidence has earned; they never create the call.

## Output

- Compact readout: numbers first, then the contrarian read in market terms, where the crowd sits in the move and what price and volume confirm. No emojis, no filler openers.
