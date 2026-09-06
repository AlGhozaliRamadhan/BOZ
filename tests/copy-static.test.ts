import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../scripts/copy-static.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('copy-static standalone sanitizer', () => {
  it('removes environment files and Next trace manifests before copying static assets', async () => {
    const moduleRoot = mkdtempSync(join(tmpdir(), 'boz-copy-static-'));
    tempRoots.push(moduleRoot);

    const staticRoot = join(moduleRoot, '.next', 'static');
    const standaloneRoot = join(moduleRoot, '.next', 'standalone');
    const traceRoot = join(standaloneRoot, '.next', 'server', 'app');
    const publicRoot = join(moduleRoot, 'public');
    mkdirSync(staticRoot, { recursive: true });
    mkdirSync(traceRoot, { recursive: true });
    mkdirSync(publicRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'chunk.js'), 'static asset');
    writeFileSync(join(publicRoot, 'logo.txt'), 'public asset');
    writeFileSync(join(standaloneRoot, '.env'), 'LOCAL_SECRET=not-for-package');
    writeFileSync(join(traceRoot, 'route.js.nft.json'), '{"files":["C:/Users/example/.boz/.env"]}');

    await run({ moduleRoot });

    expect(existsSync(join(standaloneRoot, '.env'))).toBe(false);
    expect(existsSync(join(traceRoot, 'route.js.nft.json'))).toBe(false);
    expect(existsSync(join(standaloneRoot, '.next', 'static', 'chunk.js'))).toBe(true);
    expect(existsSync(join(standaloneRoot, 'public', 'logo.txt'))).toBe(true);
  });
});
