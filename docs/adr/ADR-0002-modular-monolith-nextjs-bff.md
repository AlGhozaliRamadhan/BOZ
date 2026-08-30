# ADR-0002: Use a Modular Monolith with Next.js Route Handlers as the Backend-for-Frontend

## Status

Accepted

## Context

BOZ combines market-data retrieval, deterministic analysis, news aggregation, LLM-assisted research, settings, and a browser interface. These capabilities share types and run in one local process. Splitting them into separately deployed services would introduce networking, versioning, and operational complexity without a demonstrated scaling requirement.

The current code uses Next.js App Router pages and route handlers in `src/app`. Route handlers call analyzers and service modules directly. The overall deployment is a modular monolith, although some route handlers contain orchestration and validation logic that belongs outside the transport layer.

## Decision (What was done)

BOZ deploys as one application process. Next.js route handlers form the backend-for-frontend boundary for the React client. Domain calculations live primarily under `src/analyzers`, external integrations under `src/services`, runtime configuration under `src/config`, and shared contracts under `src/types` and `src/shared`.

The browser calls only BOZ-owned routes. Those routes coordinate Yahoo Finance, news, LLM providers, persistence, and analysis rather than exposing third-party APIs directly to the client.

## Better Way / Alternatives Considered (What could be done better)

Microservices are not justified for a local single-user product and would multiply failure modes. Moving everything into React server components would couple domain behavior to rendering and make non-UI testing harder. A separate Express or Fastify server would create clearer layering but duplicate runtime and packaging concerns already handled by Next.js.

The superior long-term form is a well-factored modular monolith. Route handlers should be thin adapters: validate an input schema, create an immutable request context, invoke an application use case, and map typed outcomes to HTTP. Feature modules should own their use cases and contracts, while infrastructure adapters implement market-data, LLM, news, and persistence ports. Dependency injection can be lightweight factories; a container framework is not required.

## Consequences

One deployment keeps local operation and debugging straightforward. Shared in-process calls are fast, and common domain types can be reused without network contracts.

Without enforced module boundaries, the monolith can degrade into tightly coupled route, service, and global-state code. Large orchestration files and duplicated prompt, retry, and error behavior are already signs of this pressure. Future work must improve internal boundaries before considering service extraction.
