# BOZ Installable CLI + Web Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm install -g boz` work so a user can type `boz` from any directory and choose between the terminal CLI and the web dashboard, which starts a local server and opens the browser.

**Architecture:** A single npm package. `boz` is a thin launcher (`src/main.ts`) that parses args, shows a Terminal | Web picker, then either runs the existing terminal REPL (`src/cli/cli.ts`) or spawns a prebuilt Next.js standalone server (`src/cli/start-web.ts`). The CLI is compiled with a dedicated `tsconfig.cli.json` (the shared config has `noEmit: true`), and the standalone web output is shipped in the package and served by `boz web`.

**Tech Stack:** Node 18+, TypeScript (tsc for CLI, Next.js standalone for web), Vitest for tests, npm for publishing.

## Global Constraints

- **Default web port: `21526`** (BOZ on a phone keypad). Override via `--port <n>` or `BOZ_PORT` env.
- **Per-user config dir: `~/.boz`** (`%USERPROFILE%\.boz` on Windows). All settings/keys written here, never `process.cwd()`.
- **Terminal | Web picker on EVERY `boz` with no args.**
- Node `>= 18` required (Next standalone output and the CLI both target Node 18+).
- All new CLI-facing code uses **relative `.js`-extension imports** (existing CLI convention, e.g. `import { vPick } from './cli.js'`). Do NOT use the `@/` alias in CLI code — that alias only exists inside the Next `src/app` tree.
- Runtime `.env` and `.env.build` live in the **package install dir**, not the user's CWD.
- Keep all existing tests passing (`npm test`).

---

## File Structure

**New files**
- `tsconfig.cli.json` — CLI-only TypeScript emit config
- `scripts/build-env.js` — writes a fresh `.env.build` with `BOZ_VERSION` at build time
- `src/cli/mode.ts` — `resolveMode()` + `pickMode()` + `printUsage()`
- `src/cli/start-web.ts` — spawn the standalone server, wait for port, open browser
- `src/utils/env-dir.ts` — resolve/ensure the per-user `~/.boz` config dir
- `tests/mode.test.ts` — unit tests for `resolveMode`/`printUsage`
- `tests/env-dir.test.ts` — unit tests for config-dir resolution

**Modified files**
- `package.json` — scripts, bin, files, engines, dependency moves
- `.npmignore` — ensure build artifacts are NOT ignored
- `src/main.ts` — launcher entry (env load → arg parse → dispatch)
- `src/cli/cli.ts` — route `upsertEnvVar` to `~/.boz/.env`
- `README.md` — global-install + usage docs
- `docs/changelog-2026-08-06-v2.2.0.md` — release notes (new)

---

### Task 1: CLI build pipeline + env template

Makes `npm run build:cli` produce a real, runnable `dist/main.js` (today `tsconfig.json` has `noEmit: true`, so `dist/` is never created).

**Files:**
- Create: `tsconfig.cli.json`
- Create: `scripts/build-env.js`
- Modify: `package.json` (scripts only)
- Modify: `.npmignore`

**Interfaces:**
- Produces: `npm run build:cli` → `dist/main.js` (+ whole `dist/` tree) with shebang; `dist/.env.build` template.

- [ ] **Step 1: Write the failing test (build gate)**

Run: `npm run build:cli 2>&1 | tail -20`
Expected: FAIL — `tsc` errors (`"Cannot write file ... because it would be overwritten by multiple input files"` or no emit because of `noEmit: true`). Record the exact output.

- [ ] **Step 2: Create `tsconfig.cli.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "incremental": false,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "src/app"]
}
```

Note: `src/app` (Next pages) is excluded so CLI emit doesn't try to compile React/JSX or pull the `@/` alias. `src/main.ts` IS included because the `bin` points at `dist/main.js` (Task 5 rewrites it as the launcher; it only imports relative CLI/utility modules). The existing relative `.js`-extension imports resolve to `.ts` via the inherited `moduleResolution: "bundler"` + `allowJs`.

- [ ] **Step 3: Create `scripts/build-env.js`**

```js
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const out = path.join(__dirname, '..', 'dist', '.env.build');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `BOZ_VERSION=${pkg.version}\n`, 'utf8');
console.log(`Wrote ${out}`);
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
"scripts": {
  "build:cli": "tsc -p tsconfig.cli.json && node scripts/build-env.js",
  "start:cli": "node dist/main.js",
  "build": "npm run build:cli"
}
```

- [ ] **Step 5: Update `.npmignore` so build output ships**

Add these lines (`.env.build` must NOT be ignored; `dist` is not in `.npmignore` today, but confirm):

```
# allow dist/ and .env.build to ship
!dist/
!dist/.env.build
```

- [ ] **Step 6: Run the build gate**

Run: `npm run build:cli`
Expected: PASS — `dist/main.js` exists, starts with `#!/usr/bin/env node`.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.cli.json scripts/build-env.js package.json .npmignore
git commit -m "build: emit CLI dist and ship env template"
```

---

### Task 2: Per-user config directory (`~/.boz`)

Creates the stable config home that the launcher, web server, and CLI settings all share.

**Files:**
- Create: `src/utils/env-dir.ts`
- Test: `tests/env-dir.test.ts`

**Interfaces:**
- Produces: `ensureConfigDir(): string`, `configEnvPath(): string`, `CONFIG_DIR_NAME = '.boz'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { ensureConfigDir, configEnvPath } from '../src/utils/env-dir';

const HOME = process.env.HOME;
const USERPROFILE = process.env.USERPROFILE;

afterEach(() => {
  if (HOME) process.env.HOME = HOME;
  else delete process.env.HOME;
  if (USERPROFILE) process.env.USERPROFILE = USERPROFILE;
  else delete process.env.USERPROFILE;
});

describe('env-dir', () => {
  it('resolves to ~/.boz on POSIX-style HOME', () => {
    process.env.HOME = '/home/test';
    delete process.env.USERPROFILE;
    expect(ensureConfigDir()).toBe('/home/test/.boz');
  });

  it('resolves to %USERPROFILE%\\.boz on Windows', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = 'C:\\Users\\test';
    const dir = ensureConfigDir();
    expect(dir.endsWith('\\.boz')).toBe(true);
  });

  it('falls back to process.cwd()/.boz when no home is set', () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(configEnvPath()).toMatch(/\.boz[\\/]\.env$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/env-dir.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/utils/env-dir.ts`**

```ts
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

export const CONFIG_DIR_NAME = '.boz';

/** Absolute path to the per-user BOZ config dir (created if missing). */
export function ensureConfigDir(): string {
  const base = homedir() || process.cwd();
  const dir = join(base, CONFIG_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path to the per-user .env file inside the config dir. */
export function configEnvPath(): string {
  return join(ensureConfigDir(), '.env');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/env-dir.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/env-dir.ts tests/env-dir.test.ts
git commit -m "feat: add per-user ~/.boz config directory"
```

---

### Task 3: Mode resolution + usage (`src/cli/mode.ts`)

Pure argument parsing that decides terminal vs web vs version/help, plus the picker.

**Files:**
- Create: `src/cli/mode.ts`
- Test: `tests/mode.test.ts`

**Interfaces:**
- Consumes: `hPick`/`vPick` from `src/cli/cli.ts` (existing pickers).
- Produces:
  - `type ModeResult = { mode: 'terminal' } | { mode: 'web', port: number } | { mode: 'version' } | { mode: 'help' } | { mode: 'pick' }`
  - `resolveMode(args: string[], env?: Record<string, string>): ModeResult`
  - `pickMode(): Promise<'terminal' | 'web'>`
  - `printUsage(): void`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveMode } from '../src/cli/mode';

describe('resolveMode', () => {
  it('returns pick for no args', () => {
    expect(resolveMode([])).toEqual({ mode: 'pick' });
  });

  it('returns terminal for "terminal"', () => {
    expect(resolveMode(['terminal'])).toEqual({ mode: 'terminal' });
  });

  it('returns web with default port for "web"', () => {
    expect(resolveMode(['web'])).toEqual({ mode: 'web', port: 21526 });
  });

  it('honors BOZ_PORT env', () => {
    expect(resolveMode(['web'], { BOZ_PORT: '9999' })).toEqual({ mode: 'web', port: 9999 });
  });

  it('honors --port flag over env', () => {
    expect(resolveMode(['web', '--port', '4000'], { BOZ_PORT: '9999' })).toEqual({ mode: 'web', port: 4000 });
  });

  it('rejects a non-numeric port', () => {
    expect(resolveMode(['web', '--port', 'abc'])).toEqual({ mode: 'web', port: 21526 });
  });

  it('returns version/help', () => {
    expect(resolveMode(['--version'])).toEqual({ mode: 'version' });
    expect(resolveMode(['-v'])).toEqual({ mode: 'version' });
    expect(resolveMode(['--help'])).toEqual({ mode: 'help' });
    expect(resolveMode(['-h'])).toEqual({ mode: 'help' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/mode.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/cli/mode.ts`**

```ts
import { hPick } from './cli.js';
import { getBuildVersion } from '../utils/version.js';

export const DEFAULT_WEB_PORT = 21526;

export type ModeResult =
  | { mode: 'terminal' }
  | { mode: 'web'; port: number }
  | { mode: 'version' }
  | { mode: 'help' }
  | { mode: 'pick' };

function parsePort(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function resolveMode(
  args: string[],
  env: Record<string, string> = process.env as Record<string, string>,
): ModeResult {
  const first = args[0];

  if (!first) return { mode: 'pick' };

  switch (first) {
    case 'terminal':
      return { mode: 'terminal' };
    case 'web': {
      const portFlagIdx = args.indexOf('--port');
      const port = portFlagIdx >= 0 ? parsePort(args[portFlagIdx + 1], DEFAULT_WEB_PORT) : parsePort(env.BOZ_PORT, DEFAULT_WEB_PORT);
      return { mode: 'web', port };
    }
    case '--version':
    case '-v':
      return { mode: 'version' };
    case '--help':
    case '-h':
    case 'help':
      return { mode: 'help' };
    default:
      return { mode: 'help' };
  }
}

export async function pickMode(): Promise<'terminal' | 'web'> {
  process.stdout.write('\n  Mode:  ');
  const idx = await hPick(['Terminal', 'Web UI']);
  process.stdout.write('\n');
  return idx === 0 ? 'terminal' : 'web';
}

export function printUsage(): void {
  process.stdout.write(
    `BOZ v${getBuildVersion()} — Behavioral Outlook Zone\n` +
    `Usage: boz [terminal|web|--version|--help]\n` +
    `  boz              choose Terminal or Web UI\n` +
    `  boz terminal     open the terminal CLI\n` +
    `  boz web          start the dashboard and open the browser\n` +
    `  boz web --port N use port N (default ${DEFAULT_WEB_PORT})\n` +
    `  boz --version    print version\n` +
    `  boz --help       show this help\n\n`,
  );
}
```

Note: `pickMode` uses `hPick` which reads a line from stdin for the picker, so it must only be called in a TTY (the launcher guards this).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/mode.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/mode.ts tests/mode.test.ts
git commit -m "feat: mode resolution and terminal/web picker"
```

---

### Task 4: Web server launcher (`src/cli/start-web.ts`)

Spawns the bundled Next standalone server, waits for the port, opens the browser.

**Files:**
- Create: `src/cli/start-web.ts`

**Interfaces:**
- Consumes: `DEFAULT_WEB_PORT` from `src/cli/mode.ts`; `openBrowser` helper (reuse pattern from `src/cli/cli.ts:304`, or export it).
- Produces: `startWebServer(port: number): Promise<void>` — resolves once the server responds, never rejects on a clean Ctrl+C.

- [ ] **Step 1: Export `openBrowser` from `src/cli/cli.ts`**

In `src/cli/cli.ts`, change `function openBrowser(url: string)` to `export function openBrowser(url: string)` (keep the same body — it already handles Windows/macOS/Linux and prints the URL on failure).

- [ ] **Step 2: Implement `src/cli/start-web.ts`**

```ts
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { openBrowser } from './cli.js';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function waitForServer(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`Server did not start on port ${port} within ${timeoutMs}ms`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

export async function startWebServer(port: number): Promise<void> {
  const serverPath = join(MODULE_ROOT, '.next', 'standalone', 'server.js');
  const child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  child.on('error', (err) => {
    console.error(`Failed to start web server: ${err.message}`);
    process.exit(1);
  });

  try {
    await waitForServer(port, 15000);
  } catch (err) {
    child.kill();
    console.error(`Web server did not start: ${(err as Error).message}`);
    process.exit(1);
  }

  const url = `http://127.0.0.1:${port}`;
  console.log(`BOZ dashboard running at ${url}`);
  openBrowser(url);

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
    process.exit(0);
  });
}
```

Note: `resolve` is missing from the import — add it: `import { resolve, join, dirname } from 'path';`. `MODULE_ROOT` resolves to the package install dir (the standalone server sits at `<pkg>/.next/standalone/server.js`, same layout the Dockerfile expects).

- [ ] **Step 3: Type-check the CLI tree**

Run: `npx tsc -p tsconfig.cli.json --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/start-web.ts src/cli/cli.ts
git commit -m "feat: web server launcher for boz web"
```

---

### Task 5: Launcher entry point (`src/main.ts`)

Rewrites the entry to load env from the package dir + `~/.boz`, parse args, guard TTY, and dispatch.

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `resolveMode`, `pickMode`, `printUsage`, `DEFAULT_WEB_PORT` from `src/cli/mode.ts`; `startWebServer` from `src/cli/start-web.ts`; `CLI` from `src/cli/cli.ts`; `ensureConfigDir`, `configEnvPath` from `src/utils/env-dir.ts`.
- Produces: the runnable `boz` binary behavior.

- [ ] **Step 1: Write the new `src/main.ts`**

```ts
#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ensureConfigDir, configEnvPath } from './utils/env-dir.js';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildEnvPath = path.join(moduleRoot, '.env.build');
const userEnvPath = configEnvPath();

// Load env in priority order: per-user ~/.boz/.env, then package template, then process env.
dotenv.config({ path: userEnvPath, override: false });
if (fs.existsSync(buildEnvPath)) dotenv.config({ path: buildEnvPath, override: false });

ensureConfigDir();

const { resolveMode, pickMode, printUsage } = await import('./cli/mode.js');

async function main(): Promise<void> {
  const { mode, port } = resolveMode(process.argv.slice(2));

  if (mode === 'version') {
    const { getBuildVersion } = await import('./utils/version.js');
    console.log(`BOZ v${getBuildVersion()}`);
    process.exit(0);
  }
  if (mode === 'help') {
    printUsage();
    process.exit(0);
  }
  if (mode === 'web') {
    const { startWebServer } = await import('./cli/start-web.js');
    await startWebServer(port);
    return;
  }
  if (mode === 'terminal') {
    const { CLI } = await import('./cli/cli.js');
    const cli = new CLI();
    await cli.run();
    return;
  }
  // mode === 'pick'
  if (!process.stdin.isTTY) {
    printUsage();
    process.exit(1);
  }
  const chosen = await pickMode();
  if (chosen === 'web') {
    const { startWebServer } = await import('./cli/start-web.js');
    await startWebServer(DEFAULT_WEB_PORT);
  } else {
    const { CLI } = await import('./cli/cli.js');
    const cli = new CLI();
    await cli.run();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Wire `upsertEnvVar` to `~/.boz/.env` in `src/cli/cli.ts`**

In `src/cli/cli.ts`, replace the two lines inside `upsertEnvVar`:

```ts
// before
const envPath  = path.resolve(process.cwd(), '.env');
```

```ts
// after
const { configEnvPath } = await import('../utils/env-dir.js');
const envPath = configEnvPath();
```

- [ ] **Step 3: Build and verify the shebang + arg parsing**

Run: `npm run build:cli && node dist/main.js --version`
Expected: prints `BOZ v2.1.2` (or whatever `package.json` version is). Confirm `head -1 dist/main.js` shows `#!/usr/bin/env node`.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/cli/cli.ts
git commit -m "feat: boz launcher dispatch (terminal/web/version/help)"
```

---

### Task 6: Publish configuration + web assets

Makes the npm package include the web standalone output and declares engines/files, and moves the Next toolchain to devDependencies so global installs stay lean.

**Files:**
- Modify: `package.json`
- Modify: `.npmignore`

**Interfaces:**
- Produces: `npm pack --dry-run` lists `.next/standalone/**, .next/static/**, public/**, dist/**, .env.build, README.md`.

- [ ] **Step 1: Write the publish config into `package.json`**

Add/replace these top-level fields:

```json
"files": [
  "dist/",
  ".next/standalone/",
  ".next/static/",
  "public/",
  ".env.build",
  "README.md"
],
"engines": {
  "node": ">=18"
}
```

Add scripts (merge with existing):

```json
"scripts": {
  "build:web": "next build",
  "prepublishOnly": "npm run build:cli && npm run build:web",
  "test:install": "npm install -g . && boz --version && boz --help"
}
```

- [ ] **Step 2: Move Next toolchain to devDependencies**

Move `next`, `react`, `react-dom`, `tsx`, `typescript` from `dependencies` to `devDependencies` in `package.json`. Keep `openai`, `yahoo-finance2`, `technicalindicators`, `marked`, `axios`, `dotenv`, `ajv`, `isomorphic-dompurify`, `rss-parser` in `dependencies` (the CLI needs these at runtime).

- [ ] **Step 3: Verify the publish gate**

Run: `npm pack --dry-run`
Expected: the file list includes `.next/standalone/`, `.next/static/`, `public/`, `dist/`, `.env.build`, `README.md`. **If `.next/standalone/**/node_modules/*` is missing** (npm strips nested node_modules), the standalone server cannot run from the package — fall back to bundling the standalone output as a tarball that `boz web` extracts on first use (see §6 of the spec). Note the outcome in a comment on this task.

- [ ] **Step 4: Commit**

```bash
git add package.json .npmignore
git commit -m "build: publish web standalone + lean global install"
```

---

### Task 7: Integration verification + README

**Files:**
- Modify: `README.md`
- Create: `docs/changelog-2026-08-06-v2.2.0.md`

**Interfaces:**
- Produces: documented install/usage + release notes; verified `npm install -g .` path.

- [ ] **Step 1: Add README install section**

Replace the "Install & Run" Docker section with a `## Install` section:

```markdown
## Install

Global install (requires Node 18+):

```bash
npm install -g boz
```

Then run from anywhere:

```bash
boz                 # choose Terminal or Web UI
boz terminal        # open the terminal CLI
boz web             # start the dashboard and open the browser
boz web --port 3001 # use a different port
boz --version
```

Settings and API keys are stored per-user in `~/.boz/.env`.
```

- [ ] **Step 2: Write `docs/changelog-2026-08-06-v2.2.0.md`**

Summarize: global `boz` install, Terminal | Web picker, `~/.boz` config, port 21526, `boz web` local server + browser, build fixes (CLI dist + env template).

- [ ] **Step 3: Full verification**

Run (in order), each expected to PASS:

1. `npm test` — all existing + new tests pass.
2. `npm run build:cli` — `dist/main.js` emitted.
3. `npm run build:web` — `.next/standalone/server.js` exists.
4. `npm pack --dry-run` — gate from Task 6.
5. `npm install -g .` in a temp prefix, then:
   - `boz --version` prints a version;
   - `boz --help` prints usage;
   - `boz web --port 43123` starts a server; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:43123` returns `200`; then Ctrl+C.
   - `boz` in a TTY shows the Terminal | Web picker (manual).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/changelog-2026-08-06-v2.2.0.md
git commit -m "docs: document global install and v2.2.0 changes"
```

---

## Self-Review

**Spec coverage:**
- §2 command surface → Task 3 (resolveMode), Task 5 (dispatch), Task 6 (scripts).
- §3 launcher wiring → Tasks 3–5.
- §4 `~/.boz` config → Task 2, Task 5 (env load + upsertEnvVar).
- §5 build pipeline (tsconfig.cli, build:cli, build:web, prepublishOnly, dep moves) → Tasks 1, 6.
- §6 web at runtime + port 21526 → Task 4, Task 3 (default port), Task 6 (files gate).
- §7 error handling → Task 4 (non-TTY guard in Task 5, port busy → waitForServer timeout, browser fallback in openBrowser, Ctrl+C forwarding).
- §8 testing → Tasks 2, 3 (unit), Task 6 (pack gate), Task 7 (integration).
- §9 out of scope → no tasks (intentionally).

**Placeholders:** none — every step has concrete code or commands.

**Type consistency:** `ModeResult`/`resolveMode`/`pickMode`/`printUsage`/`DEFAULT_WEB_PORT`/`startWebServer`/`ensureConfigDir`/`configEnvPath` are defined once each and used consistently. `resolve` import fix noted in Task 4 Step 2.
