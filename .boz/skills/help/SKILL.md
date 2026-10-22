---
name: help
description: List what BOZ can do — all slash skills
title: Help
icon: fa-circle-question
triggers: ["/help"]
---

# Help — skill directory

## When to use

Message starts with `/help`.

## Must do

1. Use the BOZ SKILLS index already present in the system prompt — it is the source of truth for available `/commands`. If the index is absent from context, say plainly that you cannot enumerate the skills reliably; never rebuild the list from memory of a past session (real skills would be dropped or invented).
2. List every skill as `/name — description`, one per line, with a one-line example arg where it takes a ticker (e.g. `/intraday NVDA`).
3. Default order follows what the user is most likely to reach next: trading lenses first (`/intraday`, `/longterm`, `/idx`, `/price`, `/sentiment`, `/newsintel`, `/global`, `/who`), `/help` last.
4. When the user seems mid-task (a ticker in play, analysis in flight), lead with the one skill they are most likely to use next, name it in a single sentence ahead of the list, then list the rest in the default order.
5. Do NOT call data tools for `/help`. Answer from context only.

## Output

- Compact list, no emojis, no filler openers.
