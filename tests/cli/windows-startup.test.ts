import { describe, expect, it } from 'vitest';
import { getStartupShortcutPath, isStartupAvailable, startupRunnerArguments } from '../../src/cli/windows-startup.js';

describe('Windows startup integration', () => {
  it('builds the per-user Startup shortcut path', () => {
    expect(getStartupShortcutPath('C:\\Users\\boz\\AppData\\Roaming')).toBe(
      'C:\\Users\\boz\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\BOZ.lnk',
    );
  });

  it('passes a hidden-runner command to the shortcut', () => {
    expect(startupRunnerArguments('C:\\Users\\boz\\.boz\\boz.vbs', 'C:\\node.exe', 'C:\\boz\\main.js', 21526)).toBe(
      '"C:\\Users\\boz\\.boz\\boz.vbs" "C:\\node.exe" "C:\\boz\\main.js" "21526"',
    );
  });

  it('only advertises startup on Windows', () => {
    expect(isStartupAvailable('linux')).toBe(false);
  });
});
