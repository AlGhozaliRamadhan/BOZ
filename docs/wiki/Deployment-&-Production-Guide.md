# Deployment & Production Guide

BOZ supports single-user, local-first Windows 11 desktop deployment. Windows x64 and ARM64 installers are published on GitHub Releases. Linux packaging and remote/multi-user deployment are not currently supported.

## Install BOZ

Download the matching per-user NSIS installer from the [latest release](https://github.com/AlGhozaliRamadhan/BOZ/releases/latest):

- `boz-v<VERSION>-windows-x64-setup.exe`
- `boz-v<VERSION>-windows-arm64-setup.exe`

The installer does not require administrator privileges. Initial beta installers are not Authenticode-signed and may show a SmartScreen **Unknown publisher** warning. The in-app update files are separately signed and tampered updates are rejected.

BOZ checks for updates once per launch. Use **Settings → Version & Updates** or **About BOZ** for an on-demand check; available updates download, verify, install, and restart automatically. The tray's **Check for updates** command remains available. Closing the main window leaves BOZ in the tray; choose **Quit** to stop the bundled server and release its memory.

## Build from source

Install Node.js 24.15.0, stable Rust, Microsoft C++ Build Tools, WebView2, and npm dependencies. Then run:

```powershell
npm ci
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:package
```

`npm run dev` starts Tauri and the fixed-port Next.js development server. `npm run dev:web` remains available for browser-only development.

## Docker development

Docker Compose remains available for isolated browser development at `http://localhost:3000`. Its host port is bound to `127.0.0.1`; do not expose BOZ publicly without an authenticated gateway and a multi-user security redesign.

## Diagnostics

The desktop host waits up to 30 seconds for its token-authenticated `/api/desktop/health` contract. A fixed-port collision shows Retry/Quit. An unexpected sidecar exit shows Restart/Quit. General dashboard readiness and version metadata are available to the local UI through `/api/version`.
