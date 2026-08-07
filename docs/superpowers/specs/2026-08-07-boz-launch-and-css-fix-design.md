# BOZ Launch UX & Standalone CSS Fix — Design

**Date:** 2026-08-07
**Status:** Draft (awaiting user review)
**Scope:** Two tightly-related fixes to the BOZ CLI launch experience and the install flow for the web standalone bundle. No mascot changes.

## Problem Statement

1. **Web launch feels like "waiting."** When a user types `boz` and picks `Web UI` from the picker, `startWebServer` blocks the whole CLI process on `waitForServer` (up to 15 seconds) before the browser opens. The CLI prompt does not return; the user cannot type any commands while the server warms. The UX is: pick web → see `BOZ dashboard running at …` line → wait → browser pops.
2. **Web UI has no CSS in the installed package.** `next.config.mjs` declares `output: 'standalone'`, and the published `files` array includes both `.next/standalone/` and `.next/static/`, but the standalone server reads static assets from `.next/standalone/.next/static/` (or `.next/standalone/public/_next/static/`), which are never populated. As a result, `npm install -g boz && boz web` produces a fully unstyled page in the browser.

## Goals

- Make `boz` (no args) → `Web UI` selected feel instant: the CLI prompt returns immediately, the browser opens when the server is actually ready, and the user can type commands during the warmup.
- Make `npm install -g .` produce a working `boz web` command with full styling, every time.
- Keep the picker (user requested).
- Do not change the mascots (user requested — both `printMascot()` in `src/cli/cli.ts` and `printMascot()` in `src/cli/mode.ts` stay as-is).
- Do not change `boz terminal`, `boz --help`, `boz --version`, or `boz web` (direct invocation) flows.

## Non-Goals

- Changing the picker into an env-driven default.
- Replacing the picker with a single-mode launch.
- Touching `next.config.mjs`, the internal `CLI` REPL, or the `package.json` `bin`/`files`/`dependencies` fields.
- A visual refresh or rewrite of either mascot.
- Adding a `/_loading` HTML route that polls `/api/health`.

## Design

### 1. Background web server (`src/cli/start-web.ts`)

Replace the current blocking `startWebServer` with a non-blocking variant that returns a handle immediately and lets the caller observe readiness asynchronously.

```ts
export interface WebServerHandle {
  url: string;
  port: number;
  /** Resolves when the server returns 2xx on `/`, rejects on timeout. */
  ready: Promise<void>;
  /** Stops the child process. Idempotent. */
  stop: () => void;
}

export function startWebServer(port: number): WebServerHandle { ... }
```

Behavior:
- `spawn` the `node .next/standalone/server.js` child with `stdio: ['ignore', 'inherit', 'inherit']` and the same `PORT`/`HOSTNAME` env vars as today.
- Kick off `waitForServer(port, 8000)` immediately, but **do not** await it inside `startWebServer`. Expose it as `handle.ready`. (8s is an honest ceiling — cold start is typically 1–3s on Next standalone; if the server is genuinely slower than 8s, the user should see a real error and use the CLI rather than wait silently.)
- On child `error` or non-zero `exit`, reject `handle.ready` with a clear message and kill nothing (the caller decides).
- The caller calls `openBrowser(url)` once `await handle.ready` resolves. `startWebServer` no longer opens the browser itself.
- `process.on('SIGINT'/'SIGTERM')` handlers move out of `start-web.ts` into the caller, so the child dies only when the parent `boz` process dies. This keeps the web server and CLI as a single unit.
- The exported `startWebServer` name and signature change from `Promise<void>` to `WebServerHandle`. All call sites updated.

### 2. Concurrent CLI + web (`src/main.ts`)

When the user picks `'web'` from the picker, the main entry now runs two things in parallel:

1. `startWebServer(port)` (synchronous spawn, returns a handle). Prints `↻ starting web server…` above the picker, then `await handle.ready` (a separate `void`-prefixed async IIFE) so it doesn't block the CLI startup. When `ready` resolves, prints `✓ web ready at <url> — opening browser…` and calls `openBrowser(url)`.
2. Constructs the `CLI` and enters its REPL **immediately after step 1 starts**, with no `await` on the web handle.

Order on `boz` (no args):
- `pickMode()` shows the picker (unchanged). User picks `'web'`.
- `startWebServer(port)` is called, returning a handle.
- `runStartupWizard()` runs (CLI init), then the CLI prompt is rendered.
- The web server warms in the background. The user can type `/run`, `/ticker`, `/model …`, etc. immediately.
- When the server returns 200 on `/`, the `✓ web ready …` line is printed using `\r\x1b[K` so it does not clobber the current prompt line.
- The browser opens.

`mode === 'web'` (direct invocation, `boz web`): unchanged. Spawn server, await `ready`, open browser, no CLI. This is the existing behavior; only the internals are non-blocking now.

`mode === 'terminal'`: unchanged.

`mode === 'version'` / `'help'`: unchanged.

### 3. Static asset copy at install (`scripts/copy-static.js`, NEW + `package.json` postinstall)

New file: `scripts/copy-static.js`. Run as `postinstall` in `package.json` so `npm install -g .` (the `test:install` script path) produces a working `boz web`.

Behavior:
- Compute `<moduleRoot>` as `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')` (same pattern as `src/main.ts`).
- Source: `<moduleRoot>/.next/static`.
- Destinations:
  - `<moduleRoot>/.next/standalone/.next/static`
  - `<moduleRoot>/.next/standalone/public/_next/static`
- If the source does not exist: log a single line `↻ copy-static: .next/static not found (run \`npm run build\` first) — skipping` and exit 0. Postinstall is best-effort — failing here would break `npm install -g .` for developers who haven't built yet, and that is worse than a missing-css first run.
- Otherwise: `fs.cpSync(source, dest, { recursive: true, force: false })` for each destination. Create parent dirs as needed. On `EPERM`/`EACCES`, log a warning and exit 0 (CI sandboxes sometimes block this — we'd rather ship a working CLI than a failed install).
- Add a shebang `#!/usr/bin/env node` and make it executable on POSIX, but Windows `npm` invokes node scripts directly so the shebang is harmless.

`package.json` change:
```json
"scripts": {
  "postinstall": "node scripts/copy-static.js",
  ...
}
```

No other `package.json` fields change. The existing `files` array already includes `.next/standalone/` and `.next/static/`, which is the correct shape — the bug is that the standalone bundle's *internal* references to `/_next/static/...` were not being satisfied.

### 4. Error handling

| Failure | Behavior |
|---|---|
| `startWebServer` child errors out (`child.on('error')`) | Reject `handle.ready` with the message. Caller prints `✗ web server failed to start: <msg>` above the prompt. CLI keeps running. |
| `waitForServer` times out at 8s | Reject `handle.ready` with `Web server did not start on port <port> within 8000ms`. Caller kills the child via `handle.stop()` and prints `✗ web server did not start — CLI mode still available`. |
| `child.on('exit')` non-zero while still warming | Reject `handle.ready` with exit code + signal. Same UI as above. |
| `copy-static.js` source missing | Log a single line, exit 0. Install succeeds. |
| `copy-static.js` permission denied | Log a warning, exit 0. |
| `npm install` aborts in postinstall | Add a `|| true` to the postinstall line so the install does not fail on copy errors. (Already implied by the design above since we exit 0 on every error path.) |

### 5. Testing

Two test files, both in `tests/cli/`:

**`tests/cli/start-web.test.ts`** — Vitest.
- Spawns `startWebServer(0)` against an ephemeral port (override the default by passing an explicit port).
- Asserts `handle.ready` resolves within 8s and `GET http://127.0.0.1:<port>/` returns 200.
- Calls `handle.stop()` and asserts the child exits.
- Skips if `.next/standalone/server.js` is absent (so unit tests don't require a prior `next build`). The skip message should hint that `npm run build` is the prerequisite.

**`tests/cli/copy-static.test.ts`** — Vitest.
- Creates a temp source dir with a single dummy file.
- Invokes `scripts/copy-static.js` with a stubbed `moduleRoot` (refactor the script to export a `run({ moduleRoot })` function and a thin CLI wrapper at the bottom, so the test can call `run` directly without spawning a subprocess).
- Asserts both destinations exist and contain the dummy file.
- Cleans up the temp dir in `afterEach`.

Both tests follow the existing testing pattern in the repo (Vitest, `*.test.ts`).

### 6. Files touched

| File | Change |
|---|---|
| `src/cli/start-web.ts` | Refactor to non-blocking; return `WebServerHandle`; move SIGINT/SIGTERM handlers out |
| `src/main.ts` | Spawn web server in parallel with CLI; render `↻ starting…` / `✓ web ready…` lines; route exit signals to both |
| `package.json` | Add `"postinstall": "node scripts/copy-static.js"` |
| `scripts/copy-static.js` | **NEW** — idempotent copy of `.next/static` into both standalone locations |
| `tests/cli/start-web.test.ts` | **NEW** — readiness + 200 + stop |
| `tests/cli/copy-static.test.ts` | **NEW** — idempotent copy, both destinations |

Files explicitly NOT touched:
- `src/cli/cli.ts` (terminal REPL, mascots)
- `src/cli/mode.ts` (picker, launch mascot)
- `src/app/layout.tsx`, `src/app/globals.css`, anything under `src/app/`
- `next.config.mjs`
- `tsconfig.json`, `tsconfig.cli.json`

## Open Questions

None at draft time. The 8s server warmup tolerance is an honest ceiling — Next standalone cold starts are typically 1–3s on a developer machine. If warmups are slower than 8s in practice, the user gets a fast, clear error and falls back to the CLI. The previous 15s ceiling was effectively a hang.
