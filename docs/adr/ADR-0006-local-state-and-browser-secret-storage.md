# ADR-0006: Persist User State in Local Files and Browser Storage

## Status

Deprecated

## Context

BOZ is a local-first application and needs to retain settings, user memory, and research-session data without requiring a hosted account or external database. The initial implementation optimized for low setup cost by using JSON and environment files on the local machine and `localStorage` in the browser.

At the audit snapshot, the system wrote memory below `~/.boz`, wrote settings to a process-working-directory `.env`, returned credential values from the settings route, and duplicated provider keys in browser `localStorage`. The first remediation slice removed browser credential persistence and secret-bearing responses and moved settings writes into an atomic per-user repository. Local JSON memory and dotenv-backed server secrets remain.

## Decision (What was done)

BOZ uses filesystem-backed persistence for local server data and browser storage for non-secret client preferences. Memory is serialized as JSON and automatically included in later research context. Settings are represented as environment-style values and can be updated through a write-only credential interface. The settings UI deletes the legacy browser key-ring entry.

This decision is deprecated. Existing behavior must be supported only long enough to migrate user data; new persistent state and new secrets must not use this pattern.

## Better Way / Alternatives Considered (What could be done better)

A hosted database and identity system would centralize state but would contradict the current local-first goal. Browser-only storage is simple but is accessible to any same-origin script and cannot safely hold reusable API keys. Plain JSON files remain suitable for small non-secret local data, provided concurrency, validation, permissions, size, and corruption are addressed.

The superior local architecture is a server-side `UserDataRepository` rooted in one explicit platform-appropriate BOZ data directory. Non-secret records should use versioned schemas, atomic replace, bounded sizes, and recovery behavior. Secrets should use the operating-system credential vault where available, with a documented server-side encrypted fallback. Settings reads should return redacted availability metadata, never secret values. Startup migration should import legacy `.env` and `localStorage` values only with explicit user consent and then remove the insecure copy. Memory should store provenance, timestamps, and user-controlled retention and should never be interpolated into privileged prompts as trusted instructions.

## Consequences

The current implementation is dependency-light and easy to inspect manually. It supports local operation without database administration.

The remediation removes browser-script access to saved credentials, path divergence, and non-atomic settings writes. Plaintext dotenv secrets are still less robust than an operating-system credential vault, and unbounded JSON memory still creates corruption and prompt-growth risks. Completing the migration introduces platform-specific credential handling and schema lifecycle work but is required before a networked mode can claim a professional security posture.
