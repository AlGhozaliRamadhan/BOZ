# ADR-0005: Orchestrate Chat Research with Tools, Evidence, and Refinement Passes

## Status

Accepted

## Context

A useful market-research assistant needs current quotes, charts, news, macro context, and local user context. A single text completion cannot reliably collect or reconcile these sources. BOZ therefore needs an orchestration layer that lets a model request tools, records evidence, and synthesizes a user-facing answer while supporting streamed progress.

The current `WebChatEngine` runs an iterative tool loop, executes compatible tool calls concurrently, records evidence, and can invoke multiple role-oriented analysis passes followed by critique or refinement. The chat route streams events to the client. Local memory can be read and updated through tools.

## Decision (What was done)

BOZ implements tool-assisted research inside the application process. The model is given a bounded catalog of BOZ-owned tools for market data, news, analysis, and memory. Tool results are returned to the model as evidence for subsequent synthesis. More complex prompts may trigger multiple specialized passes and a final refinement pass rather than relying on one response.

The client receives streaming status and answer events, allowing long-running research to remain visible. Independent tool calls may run concurrently to reduce latency.

## Better Way / Alternatives Considered (What could be done better)

A single completion would be cheaper and simpler but would substantially reduce freshness and grounding. A general agent framework could supply orchestration primitives, but it would not remove the need for BOZ-specific policies and could make execution harder to audit. Separate worker services would improve isolation but are disproportionate for the current local-first scale.

The current direction should remain, but `WebChatEngine` should be decomposed into a planner, policy/budget enforcer, tool registry, evidence ledger, and synthesizer. Each request needs hard limits for wall time, token use, tool invocations, response size, and concurrency, plus cancellation when the client disconnects. Tool output and saved memory must be treated as untrusted data, separated from system instructions, size-limited, and attributed. Memory writes that influence future sessions should require explicit user intent. The UI should expose concise evidence and provenance rather than internal chain-of-thought or unverifiable confidence language.

## Consequences

Tool use gives the assistant access to fresh, inspectable evidence and supports richer analysis than a standalone prompt. Streaming improves perceived responsiveness, and concurrency can reduce research latency.

The orchestration path is the most complex and expensive area of the application. It expands the prompt-injection surface, makes latency and provider cost variable, and is difficult to test deterministically. Strong execution budgets, observability, fixtures, and trust-boundary controls are mandatory as the feature grows.
