# ADR-0004: Support Multiple LLM Providers Behind a Shared Gateway

## Status

Accepted

## Context

BOZ users may have access to different model providers, credentials, cost profiles, and model capabilities. The application also needs a degraded mode when no remote model is configured. Provider-specific request formats must not spread through every analysis and chat workflow.

The current code supports GitHub Models, NVIDIA NIM, a configurable OpenAI-compatible endpoint, and offline behavior. `LLMAdapter` and provider configuration select models and translate shared messages, tools, structured-output requirements, and streaming behavior into provider calls. JSON Schema validation is performed with Ajv for structured responses.

## Decision (What was done)

BOZ centralizes model access behind a shared LLM adapter. Product workflows construct provider-neutral prompts and tool definitions, then use the adapter for completion, streaming, and structured response parsing. Provider and model selections are exposed through settings and can be overridden by some request flows.

The gateway gives the application one conceptual API while allowing provider-specific endpoints, API keys, and model discovery.

## Better Way / Alternatives Considered (What could be done better)

Hard-coding one provider would reduce complexity but create vendor lock-in and remove offline flexibility. Importing a large general-purpose AI framework could standardize integrations but would add dependency weight and obscure product-specific control flow. Calling providers directly from each route would be easy initially but would duplicate authentication, retry, schema, and error behavior.

The shared gateway is the correct boundary, but the current implementation should become a provider registry with small adapters implementing a typed interface. Provider capabilities—tools, streaming, JSON Schema, context window, and model discovery—should be explicit rather than inferred. Request-scoped provider/model selection must replace process-global mutation. Secrets should be resolved server-side through a credential store, and errors should be normalized without exposing provider response bodies or keys. Contract tests should cover each adapter with fixtures and timeout, retry, and malformed-response cases.

## Consequences

Users gain provider choice and workflows avoid direct vendor coupling. Shared schema validation improves the reliability of structured model output.

The abstraction must accommodate real provider differences, so the least-common-denominator interface can become misleading. Supporting custom endpoints expands the server-side request surface and creates SSRF risk unless destinations are restricted. Every additional provider increases contract-testing and model-capability maintenance costs.
