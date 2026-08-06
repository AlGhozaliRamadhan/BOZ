# v2.2.0 — 2026-08-06

## Installable CLI + Web Dashboard

BOZ is now a single npm package installable globally, so `boz` works from any directory:

- **Global install:** `npm install -g boz` (requires Node 18+). The published tarball ships the CLI (`dist/`) **and** the self-contained web dashboard (`.next/standalone/`, including its own `node_modules/`) — no separate install step needed.
- **Terminal | Web picker:** running bare `boz` opens a picker every launch — choose the terminal CLI or the web UI.
- **`boz terminal`** runs the terminal CLI directly.
- **`boz web`** starts a local dashboard server (default port `21526`, override with `--port` or the `BOZ_PORT` env var) and opens the browser automatically.
- **Per-user config:** settings and API keys are read from `~/.boz/.env` (`%USERPROFILE%\.boz\.env` on Windows), independent of the working directory.
- **Version/help:** `boz --version` and `boz --help` work from anywhere.

## Build fixes

- The CLI now builds to a real `dist/` output (`tsc -p tsconfig.cli.json`), so the published `boz` bin actually launches.
- `npm run build:web` (`next build --webpack`) produces the `.next/standalone` output the web mode runs on.
- The Next.js toolchain (`next`, `react`, `react-dom`, `tsx`, `typescript`) moved to `devDependencies` so global installs stay lean — only the runtime CLI dependencies ship with the package.
