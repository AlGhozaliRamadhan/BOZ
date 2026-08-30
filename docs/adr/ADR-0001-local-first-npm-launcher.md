# ADR-0001: Distribute a Local-First Next.js Application Through an npm Launcher

## Status

Accepted

## Context

BOZ is intended to be installed as the `@agr77/boz` npm package and launched from a terminal while presenting its primary experience in a browser. The project needs one distributable unit that can start the web server, prepare runtime configuration, find an available port, report failures, and open the local dashboard without requiring users to understand Next.js deployment commands.

The current repository therefore contains both a Next.js application under `src/app` and a Node.js launcher rooted at `src/main.ts`. The package build compiles launcher code into `dist`, produces Next.js standalone output, and includes both in the npm package.

## Decision (What was done)

BOZ uses a compiled Node.js launcher as its package entry point. The launcher parses CLI options, resolves the installed package version, configures local environment and data paths, starts the bundled standalone Next.js server, waits for it to become reachable, and opens the browser. The normal CLI path binds the server to `127.0.0.1`, reinforcing the local-first operating model.

The Next.js application remains the user interface and backend-for-frontend. The launcher owns process lifecycle concerns rather than embedding those responsibilities in UI or route modules.

## Better Way / Alternatives Considered (What could be done better)

A hosted SaaS deployment would simplify installation but would change BOZ's privacy, credential, and operating model. An Electron or Tauri desktop shell would provide stronger desktop packaging and secure credential APIs, but would add a second application runtime and release channel. Asking users to run `next start` directly would reduce launcher code but would expose implementation details and make package use fragile.

The local launcher remains appropriate, but it should become a small, explicitly tested process supervisor. Startup health checks should use a dedicated health endpoint, ports should be reserved safely, shutdown signals should be covered across supported platforms, and runtime paths should be represented by one typed configuration object. The supported Node.js versions in the package, documentation, containers, and CI must be identical.

## Consequences

The application is easy to install and retains a local-first user experience. Browser delivery avoids maintaining a custom desktop UI stack and lets the project reuse the Next.js ecosystem.

The npm artifact is unusually large because it carries a server application and compiled launcher. BOZ must test process management on Windows, macOS, and Linux, and packaging defects can break the whole product even when application tests pass. The architecture also creates a strict obligation to keep the local trust boundary intact unless an authenticated hosted mode is deliberately introduced.
