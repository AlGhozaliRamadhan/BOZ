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
});
