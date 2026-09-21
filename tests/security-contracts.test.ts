import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkloadGate } from '../src/services/security/workload-gate';

describe('security-sensitive repository contracts', () => {
  it('keeps development and desktop server traffic on the fixed loopback origin', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(pkg.scripts['dev:web']).toContain('--hostname 127.0.0.1');
    expect(pkg.scripts['dev:web']).toContain('--port 21526');
    expect(pkg.private).toBe(true);
    expect(pkg).not.toHaveProperty('bin');
    const desktop = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8');
    expect(desktop).toContain('const BOZ_ORIGIN: &str = "http://127.0.0.1:21526"');
    expect(desktop).toContain('.env("HOSTNAME", BOZ_HOST)');
    expect(desktop).toContain('.env("BOZ_CONFIG_DIR", config_dir)');
  });

  it('builds signed native x64 and ARM64 installers without npm publishing', () => {
    const workflow = readFileSync(resolve('.github/workflows/publish.yml'), 'utf8');
    expect(workflow).toContain('windows-11-arm');
    expect(workflow).toContain('TAURI_SIGNING_PRIVATE_KEY');
    expect(workflow).toContain('is required to create signed BOZ updater artifacts.');
    expect(workflow).toContain('Expected exactly one NSIS installer');
    expect(workflow).toContain('working-directory: src-tauri');
    expect(workflow).not.toContain('scripts/release/');
    expect(workflow).toContain('Create and verify updater metadata');
    expect(workflow).toContain('smoke-desktop.ps1');
    expect(workflow).toContain('smoke-nsis.ps1');
    expect(workflow).toContain("'src-tauri/target/release/boz-desktop.exe'");
    expect(workflow).toContain('artifacts/releases/${{ inputs.tag }}');
    expect(workflow).toContain('release_pr_url');
    expect(workflow).not.toContain('npm publish');
  });

  it('grants the localhost dashboard only scoped window, link, and signed-updater access', () => {
    const config = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'));
    expect(config.identifier).toBe('com.agr77.boz');
    expect(config.app).not.toHaveProperty('trayIcon');
    expect(config.app.security.capabilities).toEqual(['desktop-opener']);
    const capability = JSON.parse(readFileSync(resolve('src-tauri/capabilities/desktop-opener.json'), 'utf8'));
    expect(capability.remote.urls).toEqual(['http://127.0.0.1:21526/*']);
    expect(capability.permissions).toEqual([
      'opener:allow-open-url',
      'opener:allow-default-urls',
      'core:window:allow-minimize',
      'core:window:allow-toggle-maximize',
      'core:window:allow-is-maximized',
      'core:window:allow-start-dragging',
      'core:window:allow-close',
      'updater:default',
    ]);
    expect(JSON.stringify(capability)).not.toMatch(/filesystem|shell|process|autostart/);
    expect(config.bundle.windows.webviewInstallMode.type).toBe('downloadBootstrapper');
    expect(config.bundle.copyright).toBe('© 2026 BOZ');
    expect(config.bundle.windows.nsis.uninstallerIcon).toBe('icons/icon.ico');
    expect(config.plugins.updater.pubkey).toBeTruthy();
    expect(config.plugins.updater.endpoints).toEqual([
      'https://github.com/AlGhozaliRamadhan/BOZ/releases/latest/download/latest.json',
    ]);
  });

  it('uses BOZ-branded installer metadata and creates only one tray icon', () => {
    const desktop = readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8');
    expect(desktop).toContain('const BOZ_TRAY_ID: &str = "boz-primary-tray"');
    expect(desktop).toContain('TrayIconBuilder::with_id(BOZ_TRAY_ID)');
    expect(desktop).toContain('app.tray_by_id(BOZ_TRAY_ID)');
    expect(desktop).toContain('Skipped duplicate BOZ tray registration');
  });

  it('pins the bundled Node runtime and sanitizes desktop resources', () => {
    const preparation = readFileSync(resolve('scripts/prepare-desktop.js'), 'utf8');
    const webBuild = readFileSync(resolve('scripts/build-web.js'), 'utf8');
    expect(preparation).toContain("BUNDLED_NODE_VERSION = 'v24.15.0'");
    expect(preparation).toContain('findForbiddenFiles(resourcesRoot)');
    expect(preparation).toContain("join(resourcesRoot, 'node.exe')");
    expect(webBuild).toContain('BOZ_CONFIG_DIR: buildConfigDir');
  });

  it('keeps model selection request-local and removes autonomous memory writes', () => {
    const engine = readFileSync(resolve('src/app/api/chat/chat.engine.ts'), 'utf8');
    expect(engine).not.toContain('config.setAIModel(modelOverride)');
    expect(engine).not.toContain("name: 'update_memory'");
    expect(engine).toContain('untrusted_tool_output');
  });

  it('keeps market reasoning conditional rather than forcing private tags or automatic contrarian trades', () => {
    const engine = readFileSync(resolve('src/app/api/chat/chat.engine.ts'), 'utf8');
    const directRoute = readFileSync(resolve('src/app/api/chat/route.ts'), 'utf8');
    expect(engine).not.toContain("const PREFILL = '<think>");
    expect(engine).toContain('do not emit reasoning tags or private scratchpad text');
    expect(engine).toContain('not an automatic buy');
    expect(engine).toContain('not a strong-buy signal by itself');
    expect(engine).toContain('Do not state a numeric probability unless it is supplied by a calibrated source');
    expect(engine).toContain('MUST call web_search in addition to any fetch_news call');
    expect(engine).toContain('requiredWebSearches');
    expect(engine).toContain('automaticTickerResearchAdded');
    expect(engine).toContain('Tool-choice is not honored consistently');
    expect(engine).toContain('WEB_EVIDENCE_CITATION_RULES');
    expect(engine).toContain('formatCrowdSignalEvidence');
    expect(directRoute).toContain('not an automatic buy');
    expect(directRoute).toContain('not a strong-buy signal by itself');
    expect(directRoute).toContain('Do not state a numeric probability unless it comes from a calibrated source');
  });

  it('enforces process-wide admission limits', () => {
    const gate = new WorkloadGate(1);
    const release = gate.tryAcquire();
    expect(release).toBeTypeOf('function');
    expect(gate.tryAcquire()).toBeNull();
    release?.();
    expect(gate.tryAcquire()).toBeTypeOf('function');
  });

  it('caps the IDX universe before quote and chart work', () => {
    const universe = readFileSync(resolve('src/services/market/idx.universe.service.ts'), 'utf8');
    expect(universe).toContain('MAX_IDX_UNIVERSE_SIZE = 1_200');
    expect(universe).toContain('.slice(0, MAX_IDX_UNIVERSE_SIZE)');
  });
});
