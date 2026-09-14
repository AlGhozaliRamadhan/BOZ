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
});
