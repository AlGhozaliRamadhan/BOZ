import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('desktop version contract', () => {
  it('keeps package, Rust metadata, Tauri, and UI fallbacks synchronized', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const cargoToml = readFileSync(resolve('src-tauri/Cargo.toml'), 'utf8');
    const tauriConfig = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'));
    // Settings no longer print the version (updates live in the sidebar About
    // modal), so the sidebar is the UI fallback this contract covers.
    const sidebar = readFileSync(resolve('src/app/components/layout/Sidebar.tsx'), 'utf8');

    expect(tauriConfig.version).toBe('../package.json');
    expect(cargoToml).toMatch(new RegExp(`^version = "${packageJson.version.replaceAll('.', '\\.')}"$`, 'm'));
    expect(sidebar).toContain(`'${packageJson.version}'`);
  });

  it('pins the vendored NSIS template to the installed @tauri-apps/cli', () => {
    // The bundler renders the template together with its own utils.nsh and
    // NSIS plugins, so a template vendored from an older minor fails at
    // makensis (Win\RestartManager.nsh was externalized between 2.11 and
    // 2.12). CI never bundles the installer, so the hand-maintained header
    // in the vendored file is the drift signal.
    const installedCli = JSON.parse(
      readFileSync(resolve('node_modules/@tauri-apps/cli/package.json'), 'utf8'),
    ).version as string;
    const template = readFileSync(resolve('src-tauri/nsis/installer.nsi'), 'utf8');
    expect(template).toMatch(
      new RegExp(`Vendored from Tauri CLI ${installedCli.replaceAll('.', '\\.')}`),
    );
    // Also keep the wiring that pulls the template and the hooks in.
    const tauriConfig = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'));
    expect(tauriConfig.bundle.windows.nsis.installerHooks).toBe('installer-hooks.nsh');
    expect(tauriConfig.bundle.windows.nsis.template).toBe('nsis/installer.nsi');
  });

  it('keeps Tauri npm and Rust crates on the same major.minor (tauri build gate)', () => {
    // `tauri build` refuses to run when the JS API and the Rust crates are on
    // different minor releases. CI never builds the desktop shell, so this
    // drift went unnoticed until the v2.8.0 publish failed.
    const packageLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
    // Normalize CRLF: Windows checkouts (core.autocrlf=true) store CRLF in the
    // worktree, so the `\n`-anchored Cargo.lock regex below never matched there.
    const cargoLock = readFileSync(resolve('src-tauri/Cargo.lock'), 'utf8').replace(/\r\n/g, '\n');
    const pairs: Array<[string, string]> = [
      ['node_modules/@tauri-apps/api', 'tauri'],
      ['node_modules/@tauri-apps/plugin-updater', 'tauri-plugin-updater'],
    ];
    for (const [npmPath, crateName] of pairs) {
      const npmVersion = packageLock.packages[npmPath].version as string;
      const crateVersion = cargoLock.match(
        new RegExp(`\\[\\[package\\]\\]\\nname = "${crateName}"\\nversion = "([^"]+)"`),
      )?.[1];
      expect(crateVersion).toBeDefined();
      expect(minor(npmVersion)).toBe(minor(crateVersion!));
    }
  });
});

function minor(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}
