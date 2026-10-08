import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('desktop version contract', () => {
  it('keeps package, Rust metadata, Tauri, and UI fallbacks synchronized', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const cargoToml = readFileSync(resolve('src-tauri/Cargo.toml'), 'utf8');
    const tauriConfig = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'));
    const sidebar = readFileSync(resolve('src/app/components/layout/Sidebar.tsx'), 'utf8');
    const settings = readFileSync(resolve('src/app/components/ui/SettingsModal.tsx'), 'utf8');

    expect(tauriConfig.version).toBe('../package.json');
    expect(cargoToml).toMatch(new RegExp(`^version = "${packageJson.version.replaceAll('.', '\\.')}"$`, 'm'));
    expect(sidebar).toContain(`'${packageJson.version}'`);
    expect(settings).toContain(`'${packageJson.version}'`);
  });

  it('keeps Tauri npm and Rust crates on the same major.minor (tauri build gate)', () => {
    // `tauri build` refuses to run when the JS API and the Rust crates are on
    // different minor releases. CI never builds the desktop shell, so this
    // drift went unnoticed until the v2.8.0 publish failed.
    const packageLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
    const cargoLock = readFileSync(resolve('src-tauri/Cargo.lock'), 'utf8');
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
