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

1. Use the BOZ SKILLS index already present in the system prompt — it is the source of truth for available `/commands`.
2. List every skill as `/name — description`, one per line, with a one-line example arg where it takes a ticker (e.g. `/intraday NVDA`).
3. Do NOT call data tools for `/help`. Answer from context only.

## Output

- Compact list, no emojis, no filler openers.
