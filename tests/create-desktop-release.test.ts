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

  it('points latest.json at the NSIS updater bundle, not the standalone installer', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

    // An in-app update that downloads the raw -setup.exe runs the full
    // first-time NSIS wizard, so the user sees "Installing" and a
    // "Create folder:" log instead of an update. This is the regression that
    // shipped as PR #116.
    expect(workflow).toContain('$updaterBundles = @($installers | ForEach-Object { "$_.nsis.zip" })');
    expect(workflow).toContain('signature = $signatures[$updaterBundles[0]]');
    expect(workflow).toContain('signature = $signatures[$updaterBundles[1]]');
    expect(workflow).toContain('url = "$downloadRoot/$($updaterBundles[0])"');
    expect(workflow).toContain('url = "$downloadRoot/$($updaterBundles[1])"');
    expect(workflow).not.toContain('signature = $signatures[$installers[0]]');
    expect(workflow).not.toContain('signature = $signatures[$installers[1]]');
  });

  it('stages the updater bundle alongside the installer and fails when it is missing', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

    expect(workflow).toContain('Missing NSIS updater bundle:');
    expect(workflow).toContain('bundle.createUpdaterArtifacts must be true.');
    expect(workflow).toContain('The NSIS updater bundle signature is empty.');
    expect(workflow).toContain('Copy-Item -LiteralPath $updaterBundle');
    expect(workflow).toContain('Copy-Item -LiteralPath $updaterSignature.FullName');
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

    expect(verifier).toContain('.nsis.zip');
    expect(verifier).toContain('a standalone -setup.exe runs the full install wizard');
    expect(verifier).toContain("'windows-x86_64'");
    expect(verifier).toContain("'windows-aarch64'");
    expect(verifier).toContain('signature does not match');
    expect(verifier).toContain('is not a ZIP archive');
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
    // The updater artifact has to exist for the bundle to carry it.
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.bundle.targets).toEqual(['nsis']);
  });
});
