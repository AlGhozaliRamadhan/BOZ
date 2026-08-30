# ADR-0010: Store Active Request Selections in Process-Wide Mutable Configuration

## Status

Deprecated

## Context

BOZ needs startup configuration for provider credentials, default ticker, selected model, risk parameters, paths, and network behavior. A module-level configuration object is easy for services to import and avoids passing common values through multiple call layers.

The current `src/config/config.ts` mixes immutable startup configuration with mutable selections such as active ticker, provider, and model. Some route and chat flows mutate these values before invoking services that read the same singleton. Next.js can execute multiple requests concurrently, so one request can observe another request's selection.

## Decision (What was done)

BOZ currently exports process-wide configuration and setter behavior that allows request flows to change active runtime selections. Services then read those values implicitly. This reduced constructor and function parameters during early development.

This decision is deprecated. No new request-specific value may be added to the global configuration object, and existing mutable selections should be removed.

## Better Way / Alternatives Considered (What could be done better)

Serializing every request would avoid races but destroy concurrency and would not address hidden dependencies. Node.js `AsyncLocalStorage` could carry request context implicitly, but it is easy to misuse across background work and keeps dependencies invisible. A dependency-injection framework could manage scopes, although it is unnecessary for the size of this application.

The preferred approach is to load and validate immutable process configuration once at startup, then construct an immutable request context containing ticker, provider, model, risk policy, request ID, deadline, and cancellation signal. Route handlers should pass that context to application use cases and provider adapters explicitly. Factory functions can bind stable dependencies without a container. User preferences may supply defaults, but each request must resolve them into its own context before execution.

## Consequences

The singleton implementation is concise and made early feature development fast. Stable values such as data-directory paths and deployment configuration are still appropriate as immutable startup state.

Mutable request state creates nondeterministic cross-request behavior, complicates tests, and prevents safe multi-user or concurrent operation. Passing explicit context adds parameters and requires staged refactoring, but it makes dependencies visible, improves isolation, enables cancellation and deadlines, and is foundational for production reliability.
