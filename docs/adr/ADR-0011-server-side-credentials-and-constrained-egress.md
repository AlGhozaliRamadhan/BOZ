# ADR-0011: Keep Credentials Server-Side and Constrain Custom-Provider Egress

## Status

Accepted

## Context

BOZ allows users to configure GitHub, NVIDIA, and custom OpenAI-compatible model providers from a browser UI. At the audit snapshot, the settings API returned credential values, the browser persisted a multi-key ring in `localStorage`, settings writes targeted a different dotenv path than the launcher read, and arbitrary custom endpoints could trigger unrestricted server-side requests. A same-origin XSS or network-exposed deployment could therefore disclose reusable credentials or use BOZ as an SSRF primitive.

The local-first product still needs a low-friction way to configure provider credentials and connect to explicit loopback routers such as Ollama or 9router. It also needs remote custom providers without allowing access to private, link-local, reserved, or metadata networks.

## Decision (What was done)

Settings responses expose only `hasGithubToken`, `hasNvidiaKey`, and `hasCustomKey` presence flags. Credential inputs are write-only, are cleared from component state after submission, and are never stored in browser persistence. The UI removes the legacy `boz_provider_keys` record when it mounts.

Server settings use one `EnvSettingsRepository` rooted at `configEnvPath()`. Updates are allow-listed, serialized, written through a same-directory temporary file, atomically renamed, and assigned restrictive directory/file modes where supported. `BOZ_CONFIG_DIR` provides an explicit location override.

Custom-provider endpoints accept explicit loopback HTTP destinations for local inference and public HTTPS destinations for remote providers. The egress policy rejects URL credentials, query strings, fragments, private/link-local/reserved IP ranges, unsafe DNS answers, and redirects. Model-list responses have a byte limit. Both model discovery and actual OpenAI-compatible LLM calls use the policy. The npm launcher and Compose remain host-loopback by default.

## Better Way / Alternatives Considered (What could be done better)

Removing browser configuration entirely would reduce attack surface but would materially harm local usability. Blocking all loopback endpoints would prevent the primary offline/custom-router workflow. Allowing arbitrary destinations with a warning would leave an exploitable server-side boundary. A hosted secrets manager would be appropriate for SaaS but adds external identity and infrastructure that the local product does not otherwise require.

For stronger local protection, secrets should ultimately move from dotenv into the operating-system credential vault, with an encrypted fallback and migration lifecycle. DNS validation before each request reduces exposure but cannot provide the same connection-level guarantee as a custom network dialer that pins the validated address while preserving TLS hostname verification. A future authenticated network mode must also add authorization, origin/CSRF policy, audit logs, and rate limits; egress validation is not a replacement for those controls.

## Consequences

Saved provider credentials are no longer readable by application JavaScript or settings callers, and settings persist consistently across arbitrary launch directories. Atomic writes reduce corruption and concurrent-update loss. Centralized egress policy makes the custom-provider boundary testable and consistent across discovery and inference.

The application still stores secrets in a local plaintext file, although access modes are restricted where possible. Explicit loopback support is safe only within the documented single-user loopback trust boundary. DNS resolution adds latency to custom-provider calls, remote endpoints must use HTTPS, redirects are intentionally unsupported, and some unusual OpenAI-compatible gateways may require configuration changes before they comply with the policy.
