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

  it('does not keep a public release helper or npm release path', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');

    expect(workflow).not.toContain('scripts/release/');
    expect(workflow).not.toContain('npm publish');
    expect(workflow).toContain('artifacts/releases/${{ inputs.tag }}');
  });
});
