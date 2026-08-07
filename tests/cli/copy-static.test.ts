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
    expect(result.copied).toEqual([destA, destB]);
    expect(result.skipped).toEqual([]);
  });

  it('returns skipped when source is missing and does not throw', async () => {
    const result = await run({ moduleRoot: root });
    expect(result.copied).toEqual([]);
    expect(result.skipped).toEqual(['.next/static']);
  });
});
