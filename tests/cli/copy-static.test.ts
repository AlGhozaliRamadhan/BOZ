import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../scripts/copy-static.js';

describe('copy-static run()', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'boz-copy-static-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies .next/static into both standalone destinations', async () => {
    // arrange: fake a .next/static dir with one CSS file
    const src = join(root, '.next', 'static');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'app.css'), 'body { color: red; }');

    const destA = join(root, '.next', 'standalone', '.next', 'static');
    const destB = join(root, '.next', 'standalone', 'public', '_next', 'static');

    // act
    const result = await run({ moduleRoot: root });

    // assert: both destinations exist and contain the file
    expect(existsSync(join(destA, 'app.css'))).toBe(true);
    expect(existsSync(join(destB, 'app.css'))).toBe(true);
    expect(readFileSync(join(destA, 'app.css'), 'utf8')).toBe('body { color: red; }');
    expect(readFileSync(join(destB, 'app.css'), 'utf8')).toBe('body { color: red; }');
    const serverDest = join(root, '.next', 'standalone', 'server.js');
    expect(result.copied).toEqual([destA, destB, serverDest]);
    expect(existsSync(serverDest)).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('removes traced environment files even when static assets are missing', async () => {
    const standalone = join(root, '.next', 'standalone');
    mkdirSync(standalone, { recursive: true });
    const envFiles = ['.env', '.env.local', '.env.production'];
    for (const name of envFiles) {
      writeFileSync(join(standalone, name), 'SECRET=do-not-package');
    }
    writeFileSync(join(standalone, 'server.js'), 'console.log("safe")');

    const result = await run({ moduleRoot: root });

    expect(result.copied).toEqual([]);
    expect(result.skipped).toEqual(['.next/static']);
    expect(result.removed).toEqual(envFiles.map(name => join(standalone, name)));
    for (const name of envFiles) {
      expect(existsSync(join(standalone, name))).toBe(false);
    }
    expect(existsSync(join(standalone, 'server.js'))).toBe(true);
  });
});
