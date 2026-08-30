# BOZ Architecture Decision Records

This directory records consequential architectural choices in BOZ. Historical ADRs describe the system at the time of decision; later records supersede or constrain them without rewriting that history. An ADR is not an endorsement of every current implementation detail.

Status meanings:

- **Accepted**: the decision is part of the intended architecture and remains the default direction.
- **Proposed**: the decision is recommended but has not yet been implemented consistently.
- **Deprecated**: the implementation exists, but new work must not extend it and should migrate away from it.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [ADR-0001](ADR-0001-local-first-npm-launcher.md) | Accepted | Distribute a local-first Next.js application through an npm launcher |
| [ADR-0002](ADR-0002-modular-monolith-nextjs-bff.md) | Accepted | Use a modular monolith with Next.js route handlers as the backend-for-frontend |
| [ADR-0003](ADR-0003-market-data-technical-scoring.md) | Accepted | Aggregate market data into deterministic technical scoring |
| [ADR-0004](ADR-0004-multi-provider-llm-gateway.md) | Accepted | Support multiple LLM providers behind a shared gateway |
| [ADR-0005](ADR-0005-tool-assisted-research-orchestration.md) | Accepted | Orchestrate chat research with tools, evidence, and refinement passes |
| [ADR-0006](ADR-0006-local-state-and-browser-secret-storage.md) | Deprecated | Persist user state in local files and browser storage |
| [ADR-0007](ADR-0007-dynamic-idx-universe.md) | Accepted | Source the IDX universe dynamically from public datasets |
| [ADR-0008](ADR-0008-standalone-packaging-and-oidc-publishing.md) | Accepted | Package standalone Next.js output and publish through npm OIDC |
| [ADR-0009](ADR-0009-unauthenticated-localhost-trust-boundary.md) | Deprecated | Assume an unauthenticated single-user localhost trust boundary |
| [ADR-0010](ADR-0010-process-wide-mutable-runtime-state.md) | Deprecated | Store active request selections in process-wide mutable configuration |
| [ADR-0011](ADR-0011-server-side-credentials-and-constrained-egress.md) | Accepted | Keep credentials server-side and constrain custom-provider egress |

## Maintenance Rules

- Add a new ADR when a change materially affects trust boundaries, deployment, persistence, domain ownership, major dependencies, or cross-cutting runtime behavior.
- Do not rewrite an accepted historical decision to make it appear current. Supersede it with a new ADR and update both statuses.
- Keep implementation-specific findings in [`../CODEBASE_AUDIT.md`](../CODEBASE_AUDIT.md); ADRs explain why a direction exists and its consequences.
- Use four-digit, monotonically increasing identifiers. Filenames use lowercase kebab-case after the identifier.
