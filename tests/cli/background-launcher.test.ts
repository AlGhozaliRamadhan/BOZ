import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { backgroundChildArgs } from '../../src/cli/background-launcher.js';
import { isSystemTrayAvailable } from '../../src/cli/system-tray.js';

describe('background launcher', () => {
  it('builds an internal child command that preserves the requested port', () => {
    const args = backgroundChildArgs('C:\\boz\\dist\\main.js', 3210);
    expect(args).toEqual([
      'C:\\boz\\dist\\main.js',
      '--background-child',
      '--port',
      '3210',
    ]);
  });

  it('advertises tray support only on Windows', () => {
    expect(isSystemTrayAvailable('win32')).toBe(true);
    expect(isSystemTrayAvailable('linux')).toBe(false);
    expect(isSystemTrayAvailable('darwin')).toBe(false);
  });

  it('uses the original black-and-white BOZ artwork', () => {
    expect(existsSync(resolve(process.cwd(), 'public', 'logo-boz-transparant-white.png'))).toBe(true);
  });

});
