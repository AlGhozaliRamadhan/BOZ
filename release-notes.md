# BOZ 2.4.1 Release Notes

## Overview

BOZ 2.4.1 is a security and dependency-hardening release for the web-first 2.4 line. It updates the runtime and compiler stack, resolves all Dependabot and CodeQL alerts present at release time, and completes the move to npm OIDC trusted publishing.

## Key Changes

### Security & Runtime Hardening

- Resolved the open Dependabot and CodeQL findings with patched PostCSS and nanoid versions, least-privilege CI permissions, DOMPurify-based plain-text sanitization, and safe hostname matching ([#57](https://github.com/AlGhozaliRamadhan/BOZ/pull/57)).
- Aligned the declared and CI Node.js runtime with the versions required by the updated production dependency graph ([#57](https://github.com/AlGhozaliRamadhan/BOZ/pull/57)).

### Dependency Modernization

- Updated `isomorphic-dompurify` 3.18.0 to 3.23.0, `yahoo-finance2` 3.15.4 to 4.0.2, and `openai` 6.46.0 to 7.5.0 ([#56](https://github.com/AlGhozaliRamadhan/BOZ/pull/56)).
- Updated `tsx` 4.23.0 to 4.23.12 and TypeScript 5.9.3 to 7.0.2, including the required TypeScript 7 configuration migration ([#56](https://github.com/AlGhozaliRamadhan/BOZ/pull/56)).

### Release Automation

- Enabled npm OIDC trusted publishing with provenance from GitHub Actions ([#54](https://github.com/AlGhozaliRamadhan/BOZ/pull/54)).
- Upgraded the publishing workflow to Node.js 22 and the current npm release line for trusted-publishing compatibility ([#55](https://github.com/AlGhozaliRamadhan/BOZ/pull/55)).

## Verification Matrix

- TypeScript typecheck: Passed
- Unit and integration tests: 48 passed across 16 test files
- Standalone package build: Passed; 31 Next.js routes generated
- npm audit: 0 vulnerabilities
- Launcher smoke test: `BOZ v2.4.1`
- Standalone bundle inspection: Required runtime assets present; no environment, database, session-log, or cache leaks detected

## Installation

```bash
# Global installation via npm
npm install -g @agr77/boz@2.4.1

# Direct execution via NPX
npx @agr77/boz@2.4.1

# Offline installation from the GitHub Release asset
npm install -g agr77-boz-2.4.1.tgz
```

For a direct standalone installation, extract `boz-v2.4.1-standalone.zip` and run `node dist/main.js`.
