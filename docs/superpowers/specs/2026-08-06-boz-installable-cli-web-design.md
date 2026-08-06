# BOZ Installable CLI + Web Launcher — Design Spec

**Date:** 2026-08-06
**Status:** Draft for review

## 1. Purpose

BOZ (Behavioral Outlook Zone) v2.1.2 is currently distributed as a Docker image
or run from the repo. There is no reliable "install and run from anywhere"
path: `package.json` declares a `boz` bin pointing at `dist/main.js`, but the
TypeScript config has `noEmit: true`, so `tsc` never produces `dist/`, and the
npm package is missing the web runtime assets and a clean publish flow.

**Goal:** make `npm install -g boz` work, so a user can type `boz` from any
directory and immediately choose between the **terminal** CLI and the **web**
dashboard, which starts a local server and opens the browser.

**User decisions (2026-08-06):**
- Install via **npm global** (`npm install -g boz`).
- `boz` with no args shows a **Terminal | Web picker on every launch**.
- Web = **start local server + open browser**.
- Settings live in a **per-user `~/.boz`** config directory.
- Web default port: **21526** (override via `--port` or `BOZ_PORT`).

## 2. Command surface

| Invocation | Behavior |
|---|---|
| `boz` | Print mascot, show **Terminal \| Web** picker, then launch the chosen mode |
| `boz terminal` | Launch the terminal CLI directly (skips picker) |
| `boz web` | Start the web dashboard server and open the browser |
| `boz web --port <n>` | Start web on a specific port |
| `boz --version` | Print the BOZ version and exit 0 (non-interactive) |
| `boz --help` | Print usage and exit 0 (non-interactive) |
| `boz` (non-TTY stdin) | Print usage and exit 1 |

`BOZ_PORT` env overrides the web port when `--port` is not given.

## 3. Launcher wiring

Three thin modules behind `src/main.ts`:

- **`src/main.ts`** (rewrite): load env as today (`src/main.ts:10`), parse
  `process.argv.slice(2)` via `resolveMode(args)`, then dispatch.
- **`src/cli/mode.ts`** (new): `resolveMode(args)` — pure, unit-testable —
  returns `{ mode: 'terminal' }`, `{ mode: 'web', port }`, `{ mode: 'version' }`,
  `{ mode: 'help' }`, or `{ mode: 'pick' }`. Also `pickMode()` using the
  existing `vPick`/`hPick` pickers (`src/cli/cli.ts:61` and `:92`).
- **`src/cli/start-web.ts`** (new): locate the bundled standalone server,
  spawn it, wait until the port is listening, print the URL, open the browser,
  and forward Ctrl+C/signals.

## 4. Env & config: move to `~/.boz`

Today the CLI's `upsertEnvVar` (`src/cli/cli.ts:328`) writes `.env` to
`process.cwd()`. For a globally installed CLI this scatters `.env` files and
breaks persistence across directories.

- New `src/utils/env-dir.ts`: resolve a **per-user config directory**
  (`~/.boz` on POSIX, `%USERPROFILE%\.boz` on Windows). Always `mkdir -p` it.
- `src/main.ts` reads env from `~/.boz/.env` first, then the shipped template
  in the package, then process env. Keys written by the CLI go to
  `~/.boz/.env`.
- Windows-required behavior: the shipped template `.env.build` already exists
  (`src/main.ts:11`); keep it as a fallback so first-run setup still finds
  provider keys.
- User-visible `.env` files in the repo stay untouched (dev workflow unchanged).

## 5. Build pipeline

Today `tsconfig.json` has `"noEmit": true` (Next needs it), which is why
`dist/` is never produced.

- New **`tsconfig.cli.json`**: extends `./tsconfig.json`, sets
  `"noEmit": false`, `"outDir": "./dist"`, `"incremental": false`, and
  excludes `src/app/**` (Next pages) plus `next-env.d.ts` and `.next/**`.
  The existing `.js`-extension imports in the CLI already resolve to `.ts`
  via `moduleResolution: "bundler"` + `allowJs`.
- **Scripts** in `package.json`:
  - `build:cli` → `tsc -p tsconfig.cli.json`
  - `build:web` → `next build` (already `output: 'standalone'`)
  - `prepublishOnly` → run both `build:cli` and `build:web`
  - `start:cli` → `node dist/main.js`
- Move **`next`, `react`, `react-dom`, `tsx`, `typescript`** to
  `devDependencies` so a global install does not pull the Next toolchain onto
  the user's machine. The CLI runtime needs only the market/AI dependencies.

## 6. Web at runtime

- Ship prebuilt assets in the npm package via a `files` whitelist:
  - `dist/**` (compiled CLI)
  - `.next/standalone/**` (production server)
  - `.next/static/**`
  - `public/**`
  - the `.env.build` template
  - `README.md`
- `boz web` runs `node <install-dir>/.next/standalone/server.js` with
  `PORT`/`HOSTNAME` set from `BOZ_PORT`/`--port` (default **21526**).
- **Verification gate:** `npm pack --dry-run` must list the standalone's
  nested `node_modules` and `public`/`.next/static`. npm can strip nested
  `node_modules` from packed tarballs; if so, fall back to bundling the
  standalone output as a single tarball asset that `boz web` extracts on
  first use.

## 7. Error handling & robustness

- **Non-TTY stdin** → print usage, exit 1 (no picker hangs).
- **Port busy** → clear message naming the port and how to change it
  (`boz web --port <n>` / `BOZ_PORT`).
- **Browser open failure** → fall back to printing the URL.
- **Server crash** → relay stderr to the terminal, exit non-zero.
- **Ctrl+C** → forward signal to the server child and exit cleanly.
- **`--version`/`--help`** never require a TTY or touch the network.

## 8. Testing

- **Unit (Vitest):** `resolveMode` arg parsing; `--version`/`--help` output;
  env-dir resolution on simulated `HOME`/`USERPROFILE`.
- **Build:** `build:cli` emits `dist/main.js` with the `#!/usr/bin/env node`
  shebang intact; `npm pack --dry-run` lists expected files (the gate in §6).
- **Integration:** install into a temp npm prefix (`npm install -g`), then:
  - `boz --version` prints the version;
  - `boz web --port <free>` serves HTTP 200 on that port, then kill;
  - `boz` in a TTY shows the Terminal | Web picker (manual check).

## 9. Out of scope (for this iteration)

- Cloud-hosted web deployment; `boz web` runs locally only.
- Auto-update / version check.
- Adding new web or terminal features — the existing CLI and dashboard are
  reused unchanged.

## 10. Risks & mitigations

- **npm strips nested `node_modules` in standalone** → covered by the §6 gate
  with a tarball fallback.
- **Windows shebang / global bin** → `#!/usr/bin/env node` is the standard
  npm bin mechanism; verified in §8 integration.
- **Moving `.env` to `~/.boz`** could surprise users who currently set `.env`
  in the repo → README documents the new location; the fallback template keeps
  first-run setup working.
