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
2. Weigh every item against the ladder below before it earns a line in the answer.

## Signal vs noise

Materiality, judged per item:

- Hard numbers outrank strategy talk: results, guidance, orders, and capital changes land; a CEO talking vision does not.
- Regulatory, litigation, and supply-chain events outrank analyst calls.
- A single analyst upgrade is opinion, not news. It earns a slot only when the tape or a cluster of peers confirms it mattered.
- Advertising "AI" initiatives is usually noise. So is a product story with no orders, revenue, or spend behind it.

Freshness and corroboration:

- Recency matters. A headline already days old on the same story dates that story; it is context, not new signal, so report it once and don't resell it.
- One outlet is rumor until a second named source corroborates. Unconfirmed single-source claims wear their source and date: "per [outlet], [date]".
- A URL appears only if tool output provided one. Never construct, guess, or paste one from memory.

Company-specific vs sector-wide:

- Label every item one or the other. A sector-wide selloff is context for every ticker in it, not a fresh reason for each one: report the sector move once, then place each name against it.

## What this lens is not

- This lens reports and weighs the tape's inputs; it does not manufacture a trade plan out of a headline.
- When the user asked about a ticker, tie each market-moving item to whether it changes that ticker's near-term picture. An item that does not belongs under noise.

## Output

- Compact headline list grouped market-moving vs noise.
- Source named per item ("per Reuters").
- No emojis, no filler openers.
- Thin results read thin; never pad the tape.
