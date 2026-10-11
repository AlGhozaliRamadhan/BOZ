import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('desktop release metadata', () => {
  it('creates the signed updater manifest and checksums inside the release workflow', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

    expect(workflow).toContain('Create and verify updater metadata');
    expect(workflow).toContain("'windows-x86_64'");
    expect(workflow).toContain("'windows-aarch64'");
    expect(workflow).toContain('boz-v$version-windows-x64-setup.exe');
    expect(workflow).toContain('boz-v$version-windows-arm64-setup.exe');
    expect(workflow).toContain("'latest.json'");
    expect(workflow).toContain("'SHA256SUMS.txt'");
    expect(workflow).toContain('Get-FileHash -Algorithm SHA256');
    expect(workflow).toContain('Unexpected release artifact(s):');
    expect(workflow).toContain('RELEASE_PR_URL must be a GitHub pull request URL.');
  });

  it('points latest.json at the signed NSIS installer that Tauri actually emits', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

    // An NSIS bundle produces exactly `*-setup.exe` + `.sig`; tauri-bundler
    // emits no `*.nsis.zip`. A manifest pointing at a .nsis.zip can never
    // resolve on the Release page, so every in-app update 404s. This shipped
    // in PR #140 and broke the v2.8.1 publish.
    expect(workflow).toContain('signature = $signatures[$installers[0]]');
    expect(workflow).toContain('signature = $signatures[$installers[1]]');
    expect(workflow).toContain('url = "$downloadRoot/$($installers[0])"');
    expect(workflow).toContain('url = "$downloadRoot/$($installers[1])"');
    expect(workflow).not.toContain('nsis.zip');
    expect(workflow).not.toContain('$updaterBundle');
    expect(workflow).not.toContain('$updaterBundles');
  });

  it('stages the signed installer and its signature', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

    expect(workflow).toContain('The updater signature is empty.');
    expect(workflow).toContain('Copy-Item -LiteralPath $installer.FullName');
    expect(workflow).toContain('Copy-Item -LiteralPath $signature.FullName');
  });

  it('runs an independent manifest verification before publishing the release', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
    const verifier = readFileSync('scripts/verify-updater-manifest.ps1', 'utf8');

    expect(workflow).toContain('verify-updater-manifest.ps1');
    // Verification must run AFTER latest.json is written, or it checks nothing.
    const writtenAt = workflow.indexOf("Set-Content -LiteralPath (Join-Path $output 'latest.json')");
    const verifiedAt = workflow.indexOf('verify-updater-manifest.ps1');
    expect(writtenAt).toBeGreaterThan(-1);
    expect(verifiedAt).toBeGreaterThan(writtenAt);

    expect(verifier).toContain("-setup.exe', [System.StringComparison]::Ordinal");
    expect(verifier).toContain("'windows-x86_64'");
    expect(verifier).toContain("'windows-aarch64'");
    expect(verifier).toContain('signature does not match');
    expect(verifier).toContain('is not a Windows executable');
    expect(verifier).toContain('does not match package.json version');
  });

  it('does not keep a public release helper or npm release path', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

    expect(workflow).not.toContain('scripts/release/');
    expect(workflow).not.toContain('npm publish');
    expect(workflow).toContain('artifacts/releases/${{ inputs.tag }}');
  });
});

describe('in-app update must not look like a reinstall', () => {
  it('runs the NSIS installer passively so no setup wizard is shown', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));

    // passive -> NSIS `/P`: a progress bar, no wizard, no Back/Next/Cancel.
    // quiet (`/S`) was tried in PR #116 and still showed the wizard.
    expect(config.plugins.updater.windows.installMode).toBe('passive');
    expect(config.plugins.updater.windows.installMode).not.toBe('quiet');
    // The updater artifact must be signed for the manifest to carry a signature.
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.bundle.targets).toEqual(['nsis']);
  });
});
