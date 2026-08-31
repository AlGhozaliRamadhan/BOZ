import { describe, expect, it } from 'vitest';
import { createLauncherInfo, renderLauncher } from '../../src/cli/launcher-ui.js';

describe('launcher UI', () => {
  it('shows setup status without naming an unused provider', () => {
    const screen = renderLauncher(createLauncherInfo(21526, {}), 0);
    expect(screen).toContain('AI setup        Needs setup');
    expect(screen).not.toContain('GitHub Models');
  });

  it('shows configured when any provider is configured', () => {
    expect(createLauncherInfo(21526, { AI_PROVIDER: 'github', GITHUB_TOKEN: 'set' }).providerStatus).toBe('Configured');
  });

  it('always keeps background launch in the primary menu', () => {
    const screen = renderLauncher(createLauncherInfo(21526), 0);
    expect(screen).toContain('Run in background');
  });

  it('renders update notification banner when an update is available', () => {
    const updateInfo = {
      currentVersion: '2.4.3',
      latestVersion: '2.5.0',
      updateAvailable: true,
      checkedAt: Date.now(),
      packageUrl: 'https://www.npmjs.com/package/@agr77/boz',
      updateCommand: 'npm i -g @agr77/boz',
    };
    const screen = renderLauncher(createLauncherInfo(21526, {}, updateInfo), 0);
    expect(screen).toContain('UPDATE AVAILABLE: v2.5.0');
    expect(screen).toContain("Run 'npm i -g @agr77/boz' to update");
  });

  it('does not render update banner when no update is available', () => {
    const updateInfo = {
      currentVersion: '2.4.3',
      latestVersion: '2.4.3',
      updateAvailable: false,
      checkedAt: Date.now(),
      packageUrl: 'https://www.npmjs.com/package/@agr77/boz',
      updateCommand: 'npm i -g @agr77/boz',
    };
    const screen = renderLauncher(createLauncherInfo(21526, {}, updateInfo), 0);
    expect(screen).not.toContain('UPDATE AVAILABLE');
  });
});
