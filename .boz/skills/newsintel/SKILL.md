---
name: newsintel
description: Scan latest market headlines
title: /newsintel
icon: fa-newspaper
triggers: ["/newsintel"]
---

# NewsIntel — headline scan

## When to use

Message starts with `/newsintel` (optional query after it).

## Must do

1. Call `fetch_news` with the user query, then `web_search` for anything missing.
2. Group by market-moving vs noise. Cite sources.

## Output

- Compact headline list with source links. No emojis, no filler openers.
