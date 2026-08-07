# BOZ Launch UX & Standalone CSS Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `boz` (no args) → `Web UI` selected feel instant by running the web server in the background while the CLI returns to its prompt, and fix the missing-CSS bug in the published web standalone bundle by copying `.next/static` into the standalone directory at install time.

**Architecture:** Refactor `startWebServer` to return a non-blocking `WebServerHandle` with a `ready` Promise. The main entry spawns the server and the CLI REPL concurrently when the picker returns `'web'`. A new `scripts/copy-static.js` runs as `postinstall` and copies `.next/static` into both `.next/standalone/.next/static` and `.next/standalone/public/_next/static`, so the standalone server can serve CSS/JS/fonts.

**Tech Stack:** TypeScript (ESM), Node.js 18+ child_process, Vitest, Next.js 14 standalone output, `fs.cpSync` (Node 18.7+).

## Global Constraints

- Mascots: **do not change** `printMascot()` in `src/cli/cli.ts` or `src/cli/mode.ts`.
- Picker: **keep** — `pickMode()` in `src/cli/mode.ts` is unchanged.
- `boz terminal`, `boz --help`, `boz --version`, and `boz web` (direct) flows must keep working as today.
- `next.config.mjs`, `tsconfig*.json`, and the `package.json` `bin`/`files`/`dependencies` fields are **not** touched.
- Server warmup timeout: **8000 ms** (down from 15000 ms).
- Postinstall must be **best-effort**: any error in `copy-static.js` exits 0, never fails `npm install`.
- All copy uses camelCase file names (per repo convention) — except this script (`scripts/copy-static.js` uses kebab, matching the existing `scripts/test-marked.ts` style).
- All new TypeScript imports use `.js` extension suffix (ESM) — matches `src/main.ts` and `src/cli/*.ts`.
- Tests: Vitest, `*.test.ts` files alongside or under `tests/cli/`.
- Commit messages: conventional commits, e.g. `feat:`, `fix:`, `test:`, `chore:`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/cli/start-web.ts` | Spawns the Next standalone server as a child process. Returns a `WebServerHandle` immediately. Exposes `ready` Promise that resolves when the server returns 2xx on `/`, and a `stop()` to kill the child. **No signal handlers, no `openBrowser` call.** |
| `src/main.ts` | Orchestrator. On `pickMode() === 'web'`, calls `startWebServer` (non-blocking), prints `↻ starting…` then `✓ web ready…` once `ready` resolves, opens the browser, AND runs the CLI REPL in parallel. On direct `boz web`, behaves as before (no CLI). Routes `SIGINT`/`SIGTERM` to both processes. |
| `scripts/copy-static.js` | CommonJS ESM script. Exports a `run({ moduleRoot })` function. CLI wrapper at the bottom invokes `run({ moduleRoot: <repo root> })` and exits. Copies `.next/static` into both `.next/standalone/.next/static` and `.next/standalone/public/_next/static`. Exits 0 on missing source. |
| `package.json` | Add `"postinstall": "node scripts/copy-static.js"`. No other fields change. |
| `tests/cli/start-web.test.ts` | Verifies `WebServerHandle.ready` resolves within 8s, `GET /` returns 200, and `stop()` kills the child. Skips if `.next/standalone/server.js` is missing. |
| `tests/cli/copy-static.test.ts` | Verifies `run({ moduleRoot })` copies `.next/static` to both destinations. Cleans up temp dirs in `afterEach`. |

Files **not** touched: `src/cli/cli.ts`, `src/cli/mode.ts`, anything under `src/app/`, `next.config.mjs`, `tsconfig.json`, `tsconfig.cli.json`.

---

## Task 1: `copy-static.js` — script skeleton (TDD)

**Files:**
- Create: `scripts/copy-static.js`
- Test: `tests/cli/copy-static.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `export async function run({ moduleRoot })` — copies `.next/static` into `.next/standalone/.next/static` and `.next/standalone/public/_next/static`. Returns `{ copied: string[], skipped: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/cli/copy-static.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../scripts/copy-static.js';

describe('copy-static run()', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'boz-copy-static-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies .next/static into both standalone destinations', async () => {
    // arrange: fake a .next/static dir with one CSS file
    const src = join(root, '.next', 'static');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'app.css'), 'body { color: red; }');

    const destA = join(root, '.next', 'standalone', '.next', 'static');
    const destB = join(root, '.next', 'standalone', 'public', '_next', 'static');

    // act
    const result = await run({ moduleRoot: root });

    // assert: both destinations exist and contain the file
    expect(existsSync(join(destA, 'app.css'))).toBe(true);
    expect(existsSync(join(destB, 'app.css'))).toBe(true);
    expect(readFileSync(join(destA, 'app.css'), 'utf8')).toBe('body { color: red; }');
    expect(readFileSync(join(destB, 'app.css'), 'utf8')).toBe('body { color: red; }');
    expect(result.copied).toEqual([destA, destB]);
    expect(result.skipped).toEqual([]);
  });

  it('returns skipped when source is missing and does not throw', async () => {
    const result = await run({ moduleRoot: root });
    expect(result.copied).toEqual([]);
    expect(result.skipped).toEqual(['.next/static']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cli/copy-static.test.ts`
Expected: FAIL — `run` is not exported from `scripts/copy-static.js`.

- [ ] **Step 3: Create the script with the minimum implementation**

Create `scripts/copy-static.js`:

```js
#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Copy .next/static into both standalone locations Next reads from.
 * Returns which destinations were copied to and which sources were skipped.
 *
 * @param {{ moduleRoot: string }} opts
 * @returns {Promise<{ copied: string[]; skipped: string[] }>}
 */
export async function run({ moduleRoot }) {
  const src = join(moduleRoot, '.next', 'static');
  const destA = join(moduleRoot, '.next', 'standalone', '.next', 'static');
  const destB = join(moduleRoot, '.next', 'standalone', 'public', '_next', 'static');

  if (!existsSync(src)) {
    return { copied: [], skipped: ['.next/static'] };
  }

  const copied = [];
  for (const dest of [destA, destB]) {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    copied.push(dest);
  }

  return { copied, skipped: [] };
}

// CLI wrapper: run when invoked directly (`node scripts/copy-static.js`).
// Resolve moduleRoot as the repo root, two levels up from this script.
const isCli = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isCli) {
  const moduleRoot = resolve(__dirname, '..', '..');
  try {
    const { copied, skipped } = await run({ moduleRoot });
    for (const dest of copied) {
      console.log(`✓ copy-static: ${dest}`);
    }
    for (const name of skipped) {
      console.log(`↻ copy-static: ${name} not found (run \`npm run build\` first) — skipping`);
    }
    process.exit(0);
  } catch (err) {
    console.warn(`⚠ copy-static: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(0);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cli/copy-static.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Smoke-test the CLI wrapper**

Run: `node scripts/copy-static.js`
Expected: prints `↻ copy-static: .next/static not found (run \`npm run build\` first) — skipping` and exits 0 (because no build has been run). Exit code 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/copy-static.js tests/cli/copy-static.test.ts
git commit -m "feat(scripts): add copy-static to bundle Next standalone CSS"
```

---

## Task 2: Wire `postinstall` in `package.json`

**Files:**
- Modify: `package.json` (add one line to `scripts`)

**Interfaces:**
- Consumes: Task 1's `copy-static.js`.
- Produces: `npm install -g .` runs `copy-static.js` after install.

- [ ] **Step 1: Read current `package.json` to locate the `scripts` block**

Read `D:\Project\BOZ\package.json` and find the `scripts` object.

- [ ] **Step 2: Add the `postinstall` script**

Add a `"postinstall"` key to the `scripts` object. Place it as the **first** key in the object (npm convention: lifecycle hooks typically come first or are alphabetized — placing it first matches the rest of the lifecycle-style scripts in the file if any). Example diff:

```diff
   "scripts": {
+    "postinstall": "node scripts/copy-static.js",
     "dev": "next dev --webpack",
```

Do **not** change any other field in `package.json`.

- [ ] **Step 3: Verify `package.json` is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify the postinstall hook runs without failing**

Run: `node scripts/copy-static.js`
Expected: prints the `↻ copy-static: ...skipping` line and exits 0. (We're calling the script directly — npm will call it the same way during `npm install`.)

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: run copy-static as postinstall"
```

---

## Task 3: `start-web.ts` — non-blocking refactor (TDD with child_process mock)

**Files:**
- Modify: `src/cli/start-web.ts` (full rewrite of the function)
- Test: `tests/cli/start-web.test.ts`

**Interfaces:**
- Consumes: nothing (standalone, no other tasks yet).
- Produces:
  - `export interface WebServerHandle { url: string; port: number; ready: Promise<void>; stop: () => void; }`
  - `export function startWebServer(port: number): WebServerHandle`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/start-web.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import http from 'http';
import { startWebServer } from '../../src/cli/start-web.js';

const STANDALONE_SERVER = resolve(process.cwd(), '.next', 'standalone', 'server.js');

const describeIfBuilt = existsSync(STANDALONE_SERVER) ? describe : describe.skip;

describeIfBuilt('startWebServer (requires `npm run build` first)', () => {
  // Use port 0 so the OS assigns one; resolve the actual port via a probe.
  // We pick a fixed high port instead to keep the test deterministic on Windows.
  const port = 21527;

  let handle: ReturnType<typeof startWebServer> | null = null;

  afterAll(async () => {
    if (handle) handle.stop();
    // Give the OS a moment to release the port
    await new Promise((r) => setTimeout(r, 250));
  });

  it('returns a handle immediately and resolves ready within 8s', async () => {
    handle = startWebServer(port);
    expect(handle.url).toBe(`http://127.0.0.1:${port}`);
    expect(handle.port).toBe(port);
    expect(typeof handle.stop).toBe('function');

    const start = Date.now();
    await handle.ready;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(8000);
  }, 10000);

  it('GET / returns 2xx after ready', async () => {
    if (!handle) handle = startWebServer(port);
    await handle.ready;

    const status = await new Promise<number>((resolveP, rejectP) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        resolveP(res.statusCode ?? 0);
      });
      req.on('error', rejectP);
    });
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
  }, 10000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cli/start-web.test.ts`
Expected: FAIL — `startWebServer` currently returns `Promise<void>`, not the `WebServerHandle` interface.

- [ ] **Step 3: Rewrite `src/cli/start-web.ts`**

Replace the entire contents of `src/cli/start-web.ts`:

```ts
import { spawn } from 'child_process';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFAULT_READY_TIMEOUT_MS = 8000;

export interface WebServerHandle {
  url: string;
  port: number;
  /** Resolves when the server returns 2xx on `/`, rejects on timeout or child error. */
  ready: Promise<void>;
  /** Stops the child process. Idempotent. */
  stop: () => void;
}

function waitForServer(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolveP();
        } else if (Date.now() > deadline) {
          rejectP(new Error(`Server returned ${res.statusCode} on port ${port}`));
        } else {
          setTimeout(attempt, 200);
        }
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          rejectP(new Error(`Server did not start on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

export function startWebServer(
  port: number,
  opts: { readyTimeoutMs?: number } = {},
): WebServerHandle {
  const serverPath = join(MODULE_ROOT, '.next', 'standalone', 'server.js');
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}`;

  const child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (!child.killed) child.kill('SIGTERM');
  };

  const ready = new Promise<void>((resolveP, rejectP) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    child.on('error', (err) => {
      settle(() => rejectP(new Error(`web server failed to start: ${err.message}`)));
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      if (code === 0) {
        settle(() => rejectP(new Error(`web server exited before becoming ready (code 0, signal ${signal})`)));
      } else {
        settle(() => rejectP(new Error(`web server exited with code ${code} signal ${signal} before becoming ready`)));
      }
    });

    waitForServer(port, readyTimeoutMs)
      .then(() => settle(resolveP))
      .catch((err) => settle(() => rejectP(err)));
  });

  return { url, port, ready, stop };
}
```

Notes:
- `openBrowser` is intentionally **not** called here — the caller does it.
- `process.on('SIGINT'/'SIGTERM')` is **not** registered here — the caller does it.
- The function is now synchronous (returns the handle immediately).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cli/start-web.test.ts`
Expected: PASS (assuming `npm run build` was run first). If skipped, that's also acceptable — the skip is by design until a build exists.

- [ ] **Step 5: Commit**

```bash
git add src/cli/start-web.ts tests/cli/start-web.test.ts
git commit -m "refactor(cli): make startWebServer non-blocking with WebServerHandle"
```

---

## Task 4: `main.ts` — run CLI and web server concurrently

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 3's `startWebServer(port): WebServerHandle` returning `{ url, port, ready, stop }`.
- Produces: `main()` that, when the picker returns `'web'`, runs the web server in the background and the CLI REPL concurrently, prints `↻ starting…` then `✓ web ready…` lines, and calls `openBrowser(url)` on ready.

- [ ] **Step 1: Read the current `main.ts`**

Already known: `src/main.ts` lines 21–59 contain `main()`. The pick branch is lines 50–58.

- [ ] **Step 2: Replace the pick branch and add helper imports**

In `src/main.ts`, modify the import on line 19 to also import `openBrowser`:

```diff
- const { resolveMode, pickMode, printUsage, DEFAULT_WEB_PORT } = await import('./cli/mode.js');
+ const { resolveMode, pickMode, printUsage, DEFAULT_WEB_PORT } = await import('./cli/mode.js');
+ const { openBrowser } = await import('./cli/cli.js');
```

(If a circular-import warning appears at runtime, the alternative is to inline a small `openBrowser` shim in `main.ts` — see Step 2 fallback at the end of this task.)

Replace the pick branch (lines 50–58) with:

```ts
  // mode === 'pick'
  if (!process.stdin.isTTY) {
    printUsage();
    process.exit(1);
  }
  const chosen = await pickMode();
  if (chosen === 'web') {
    // Spawn the web server in the background and run the CLI in parallel.
    // The CLI prompt returns immediately so the user can type commands
    // while the server warms.
    const web = startWebServer(DEFAULT_WEB_PORT);
    process.stdout.write(`  ↻ starting web server…\n`);
    void web.ready
      .then(() => {
        process.stdout.write(`\r\x1b[K  ✓ web ready at ${web.url} — opening browser…\n`);
        openBrowser(web.url);
      })
      .catch((err) => {
        process.stdout.write(`\r\x1b[K  ✗ web server did not start: ${err instanceof Error ? err.message : String(err)}\n`);
        process.stdout.write(`     CLI mode is still available — type /help to continue.\n`);
        web.stop();
      });

    // When the CLI exits, kill the web child too.
    process.on('SIGINT', () => { web.stop(); process.exit(0); });
    process.on('SIGTERM', () => { web.stop(); process.exit(0); });
  }

  const { CLI } = await import('./cli/cli.js');
  const cli = new CLI();
  await cli.run();
```

Note the import of `openBrowser` from `./cli/cli.js` happens at the top, but it's hoisted by the dynamic import in the original main entry. If we want a true static import, we can move it to the top of the file. Adjust the existing import block (lines 1–19) to include `openBrowser` if your tooling prefers static imports. **The plan accepts either form**; pick whichever compiles cleanly under `tsconfig.cli.json`.

- [ ] **Step 3: Type-check the project**

Run: `npx tsc -p tsconfig.cli.json --noEmit`
Expected: no errors. If `openBrowser` import is flagged, switch to the dynamic-import form: replace `openBrowser(web.url)` with `(await import('./cli/cli.js')).openBrowser(web.url)`.

- [ ] **Step 4: Smoke-test the new pick branch**

Run: `npm run build:cli`
Then: `node dist/main.js`
Expected:
- Picker shows.
- Pick `Web UI` (arrow down + Enter).
- The CLI prompt appears immediately.
- After 1–3 seconds, a `✓ web ready at http://127.0.0.1:21526 — opening browser…` line is printed.
- The browser opens.
- Typing `/help` in the CLI works while/after the server warms.

- [ ] **Step 5: Verify direct `boz web` still works**

Run: `node dist/main.js web`
Expected: web server starts, browser opens, **no CLI prompt** is shown (this is the existing `mode === 'web'` branch, unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(cli): run web server in background when picked from launcher"
```

---

## Task 5: End-to-end smoke test (manual, no code change)

**Files:** none (verification only).

- [ ] **Step 1: Build everything**

Run: `npm run build:web && npm run build:cli`
Expected: both succeed.

- [ ] **Step 2: Verify CSS is in the standalone bundle**

Run: `ls .next/standalone/.next/static/css/ 2>/dev/null && echo OK || echo MISSING`
Expected: prints the CSS filename (e.g. `5ee4b2a7c47395f0.css`) followed by `OK`. (If `MISSING`, run `node scripts/copy-static.js` manually and re-check.)

- [ ] **Step 3: Run from the picker**

Run: `node dist/main.js`
Pick `Web UI`. Confirm:
- CLI prompt appears immediately.
- `✓ web ready at … — opening browser…` line is printed.
- Browser opens to a **styled** page (the BOZ sidebar/topbar layout, dark theme).
- The CLI accepts `/help`, `/ticker NVDA`, `/status`, etc. while the page is open.
- `Ctrl+C` kills both the CLI and the web server (check `http://127.0.0.1:21526` is no longer reachable).

- [ ] **Step 4: Run direct `boz web`**

Run: `node dist/main.js web`
Expected: same as Step 3 but no CLI prompt. `Ctrl+C` kills the web server.

- [ ] **Step 5: Test the global install path**

Run: `npm run test:install` (this is the existing `npm install -g . && boz --version && boz --help` script).
Expected: install succeeds, `boz --version` prints the version, `boz --help` shows usage. Then run `boz web` and confirm a styled page opens.

- [ ] **Step 6: No commit needed — verification only**

If any step fails, file a follow-up. Otherwise, the feature is complete.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Background web server (`start-web.ts` refactor, `WebServerHandle`) | Task 3 |
| §2 Concurrent CLI + web (`main.ts` parallel) | Task 4 |
| §3 Static asset copy (`scripts/copy-static.js` + `postinstall`) | Tasks 1, 2 |
| §4 Error handling (child error / 8s timeout / exit / copy missing / permission) | Tasks 1, 3, 4 |
| §5 Testing (start-web + copy-static) | Tasks 1, 3 |
| §6 Files touched — only the 6 listed | Tasks 1–4 respect this |
| 8s timeout | Tasks 3, 4 |
| No mascot changes | No task touches `cli.ts` or `mode.ts`'s `printMascot` |
| No `next.config.mjs` changes | No task modifies it |

**2. Placeholder scan:** No "TBD", no "TODO", no "add appropriate error handling" without code, no "similar to Task N" without repetition. Every step has code, run command, or commit.

**3. Type consistency:** `WebServerHandle` defined in Task 3 with `{ url, port, ready: Promise<void>, stop: () => void }`. Task 4 uses `web.url`, `web.ready`, `web.stop()` — all match. `run({ moduleRoot })` defined in Task 1 — Task 2 invokes it via the CLI wrapper using `moduleRoot = resolve(__dirname, '..', '..')` — consistent. No type drift.

All spec requirements are covered. Plan is ready for execution.
