import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isSystemTrayAvailable, startSystemTray } from '../../src/cli/system-tray.js';

describe('system-tray', () => {
  it('identifies platform support correctly', () => {
    expect(isSystemTrayAvailable('win32')).toBe(true);
    expect(isSystemTrayAvailable('linux')).toBe(false);
    expect(isSystemTrayAvailable('darwin')).toBe(false);
  });

  it('verifies the original BOZ artwork exists for tray icon generation', () => {
    const defaultLogo = resolve(process.cwd(), 'public', 'logo-boz-solid.png');
    expect(existsSync(defaultLogo)).toBe(true);
  });

  it('rejects execution on unsupported non-Windows platforms or starts cleanly on Windows', async () => {
    if (process.platform !== 'win32') {
      await expect(startSystemTray({
        url: 'http://127.0.0.1:21526',
        startupAvailable: false,
        startupEnabled: false,
        onExit: () => {},
        onToggleStartup: () => {},
      })).rejects.toThrow('The BOZ system tray is currently available on Windows only.');
    } else {
      const handle = await startSystemTray({
        url: 'http://127.0.0.1:21526',
        startupAvailable: true,
        startupEnabled: false,
        onExit: () => {},
        onToggleStartup: () => {},
      });
      expect(handle).toBeDefined();
      expect(typeof handle.stop).toBe('function');
      handle.stop();
    }
  }, 15000);
});
