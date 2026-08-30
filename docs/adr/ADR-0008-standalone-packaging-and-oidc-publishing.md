# ADR-0008: Package Standalone Next.js Output and Publish Through npm OIDC

## Status

Accepted

## Context

BOZ must distribute a runnable web application as an npm package without requiring consumers to clone the repository or install development dependencies. Releases also need a trustworthy publication path that does not depend on a long-lived npm token stored in repository secrets.

The repository builds the launcher into `dist`, produces Next.js standalone output, copies required static and public assets, limits package contents with the `files` manifest, and publishes through GitHub Actions trusted publishing with OpenID Connect. Release archives are generated separately for GitHub Releases.

## Decision (What was done)

BOZ packages the compiled launcher, `.next/standalone`, `.next/static`, public assets, and the minimal supporting files needed at runtime. Packaging scripts sanitize copied standalone content and fail if sanitization fails. The npm publication workflow uses GitHub Actions OIDC rather than a repository-held npm authentication token.

Generated release archives are kept under versioned `artifacts/releases` directories and are not committed. GitHub Release bodies point to the merged release pull request as the canonical change narrative.

## Better Way / Alternatives Considered (What could be done better)

Publishing only source code would create smaller artifacts but would require consumers to build Next.js locally. Shipping a container would provide a stronger runtime envelope but would not match the simple npm launcher experience. A desktop installer could improve native integration but introduces platform signing and multiple release pipelines.

The standalone package and OIDC publication choices should remain, but the pipeline needs a machine-readable artifact manifest, entry allowlist verification, a package size budget, secret and cache scans, checksum generation, and clean-room install and launch tests for each supported Node.js line. The publish workflow must run all canonical release gates—including both audits and the built launcher version check—rather than relying on documentation. Generated data caches and TypeScript build metadata should be excluded. Docker, README, `engines`, CI, and packaged runtime versions must be reconciled.

## Consequences

Users receive a self-contained package and trusted publishing reduces exposure to reusable npm credentials. A curated file allowlist and sanitizer reduce accidental inclusion of local secrets.

The artifact is large and currently duplicates substantial static output. Packaging correctness becomes a security boundary, not just a build concern. GitHub Actions, npm trusted-publisher configuration, and Node.js compatibility must remain synchronized, and an incomplete release gate can publish a package that passed ordinary CI but not the documented production checks.
