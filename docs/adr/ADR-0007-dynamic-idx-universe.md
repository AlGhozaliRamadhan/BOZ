# ADR-0007: Source the IDX Universe Dynamically from Public Datasets

## Status

Accepted

## Context

The Indonesia Stock Exchange universe changes over time. Hard-coding a short ticker list would make setup scanning stale and require a software release for every listing change. BOZ needs a practical way to discover the available IDX symbols while retaining enough local resilience to perform scans when an upstream dataset is unavailable.

The current IDX universe service downloads size-bounded public CSV data from GitHub-hosted sources, validates and normalizes symbols, and caches the result under the per-user BOZ configuration directory. It is designed to fall back to a bundled JSON universe, although that reviewed fallback file is still absent. Setup scanning then analyzes the resolved symbols in bounded batches.

## Decision (What was done)

BOZ dynamically sources and normalizes the IDX ticker universe from public datasets. It persists an atomically replaced per-user cache to reduce repeated downloads and supports a repository-owned fallback concept. The setup scanner consumes this universe rather than maintaining its own symbol list and limits concurrent analysis through batching.

## Better Way / Alternatives Considered (What could be done better)

A manually maintained list would be deterministic but would age quickly. Scraping the exchange website would be fragile and may violate usage expectations. A licensed exchange feed would provide stronger provenance and service guarantees but adds cost and contractual constraints.

The public-data approach remains proportionate, but upstream sources must be treated as untrusted supply-chain inputs. The repository needs an actual reviewed fallback file, complete CSV/schema validation, checksum or provenance metadata, and an explicit provider health model. The implemented per-user cache location, download limit, symbol allowlist, and expiry should remain. A `SymbolUniverseProvider` interface would allow a licensed or official provider to replace the public feed later. Scan rankings should report the data timestamp and must not force relative winners into an absolute BUY classification.

## Consequences

BOZ can follow listing changes without a release and can scan a broader market. Caching reduces external traffic and improves responsiveness.

Availability and correctness now depend on third-party datasets whose format or repository may change. An absent fallback can turn a transient network problem into a feature outage. Dynamic downloads also add validation and provenance responsibilities, while full-universe technical analysis can remain slow and rate-limit intensive.
