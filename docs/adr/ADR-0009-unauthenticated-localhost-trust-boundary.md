# ADR-0009: Assume an Unauthenticated Single-User Localhost Trust Boundary

## Status

Deprecated

## Context

The npm launcher starts BOZ for one user on their own machine and normally binds to loopback. Under that assumption, the original implementation did not add identity, sessions, authorization, CSRF protection, or per-user tenancy to route handlers. This kept the local installation simple.

The first remediation slice aligned Docker with the supported Node.js line, made Compose publish only on host loopback, removed secret-bearing settings responses, and constrained custom-provider egress. The container process must still bind `0.0.0.0` internally for port forwarding, and no middleware prevents an operator from publishing it broadly. No authenticated network mode or CSP exists.

## Decision (What was done)

BOZ currently exposes its backend-for-frontend routes without authentication or authorization and treats same-origin browser requests as belonging to the local operator. The primary launcher and default Compose publication bind to `127.0.0.1`, but alternative container or server execution paths can expose the same API to a wider network.

This implicit trust-boundary decision is deprecated because the code does not reliably guarantee the conditions under which it is safe.

## Better Way / Alternatives Considered (What could be done better)

Adding a complete multi-user identity platform to every local installation would impose unnecessary complexity. Relying only on documentation to warn against network exposure is insufficient. A random bearer token in URLs would improve opportunistic protection but can leak through logs or browser history and does not solve all browser-origin risks.

BOZ should define two explicit modes. Local mode must enforce loopback binding, reject non-loopback host headers where feasible, keep secrets server-side, set a restrictive CSP and security headers, apply origin and CSRF checks to mutations, and block private, loopback, link-local, metadata, and unsafe redirect destinations for custom-provider requests. Any future network or hosted mode must require authentication, authorization, encrypted server-side secrets, tenant isolation, audit logs, and rate limits. Docker should default to loopback publication or clearly require the secured mode.

## Consequences

The current no-login flow is convenient for a genuinely local single-user tool and reduces account-related code.

When the application is exposed beyond loopback, every route effectively becomes public, including expensive AI operations and credential-related settings. SSRF, cross-origin actions, and browser injection have much greater impact under this model. Enforcing explicit modes may add a startup token or local-session handshake, but it removes an ambiguous and unsafe deployment state.
