import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertBundledNode,
  BUNDLED_NODE_VERSION,
  findForbiddenFiles,
  injectStaleRuntimeCacheGuard,
  prepareDesktopResources,
  RUNTIME_CACHE_GUARD_MARKER,
  RUNTIME_CACHE_GUARD_SNIPPET,
} from '../scripts/prepare-desktop.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'boz-desktop-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, '.next', 'standalone'), { recursive: true });
  writeFileSync(join(root, '.next', 'standalone', 'server.js'), 'console.log("ready")');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.8.7' }));
  const nodeExecutable = join(root, 'node.exe');
  writeFileSync(nodeExecutable, 'fake executable');
  return { root, nodeExecutable };
}

describe('desktop resource preparation', () => {
  it('requires the pinned native Windows Node.js runtime', () => {
    expect(() => assertBundledNode({ platform: 'linux', version: BUNDLED_NODE_VERSION })).toThrow(/Windows/);
    expect(() => assertBundledNode({ platform: 'win32', version: 'v26.0.0' })).toThrow(BUNDLED_NODE_VERSION);
    expect(() => assertBundledNode({ platform: 'win32', version: BUNDLED_NODE_VERSION })).not.toThrow();
  });

  it('copies a clean standalone server and records architecture metadata', () => {
    const { root, nodeExecutable } = fixture();
    const result = prepareDesktopResources({
      moduleRoot: root,
      nodeExecutable,
      platform: 'win32',
      nodeVersion: BUNDLED_NODE_VERSION,
      architecture: 'arm64',
    });
    expect(result.metadata).toMatchObject({ version: '9.8.7', architecture: 'arm64', node: BUNDLED_NODE_VERSION });
    expect(findForbiddenFiles(result.resourcesRoot)).toEqual([]);

    const stagedServer = readFileSync(join(result.resourcesRoot, 'server', 'server.js'), 'utf8');
    expect(stagedServer).toContain(RUNTIME_CACHE_GUARD_MARKER);
    expect(stagedServer).toContain('route-cache');
    expect(stagedServer).toContain('.boz-cache-build-id');
    expect(stagedServer).toContain('console.log("ready")');
  });

  it('injects the runtime cache guard exactly once on repeat staging', () => {
    const { root, nodeExecutable } = fixture();
    prepareDesktopResources({
      moduleRoot: root,
      nodeExecutable,
      platform: 'win32',
      nodeVersion: BUNDLED_NODE_VERSION,
      architecture: 'x64',
    });
    const stagedServerPath = join(root, 'src-tauri', 'resources', 'server', 'server.js');
    expect(injectStaleRuntimeCacheGuard(stagedServerPath)).toBe(false);
    const stagedServer = readFileSync(stagedServerPath, 'utf8');
    expect(stagedServer.split(RUNTIME_CACHE_GUARD_SNIPPET).length - 1).toBe(1);
  });

  it('purges stale runtime caches when the packaged build changes', () => {
    const serverDir = mkdtempSync(join(tmpdir(), 'boz-cache-guard-'));
    try {
      const staleTargets = [
        join(serverDir, '.next', 'server', 'route-cache'),
        join(serverDir, 'public', '_next'),
        join(serverDir, '.next', 'cache'),
      ];
      for (const target of staleTargets) {
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, 'stale-entry.txt'), 'stale');
      }
      mkdirSync(join(serverDir, '.next'), { recursive: true });
      writeFileSync(join(serverDir, '.next', 'BUILD_ID'), 'fresh-build-id\n');
      writeFileSync(join(serverDir, 'package.json'), JSON.stringify({ type: 'module' }));
      writeFileSync(join(serverDir, 'server.js'), RUNTIME_CACHE_GUARD_SNIPPET);

      const firstRun = spawnSync(process.execPath, [join(serverDir, 'server.js')], { encoding: 'utf8' });
      expect(firstRun.status).toBe(0);
      expect(firstRun.stdout).toContain('purged runtime caches');
      for (const target of staleTargets) {
        expect(existsSync(target), `stale directory ${target} should be gone`).toBe(false);
      }
      expect(readFileSync(join(serverDir, '.next', '.boz-cache-build-id'), 'utf8').trim()).toBe('fresh-build-id');

      const kept = join(serverDir, '.next', 'server', 'kept.txt');
      mkdirSync(join(serverDir, '.next', 'server'), { recursive: true });
      writeFileSync(kept, 'current build');
      const secondRun = spawnSync(process.execPath, [join(serverDir, 'server.js')], { encoding: 'utf8' });
      expect(secondRun.status).toBe(0);
      expect(secondRun.stdout).toContain('build unchanged; kept runtime caches');
      expect(readFileSync(kept, 'utf8')).toBe('current build');
    } finally {
      rmSync(serverDir, { recursive: true, force: true });
    }
  });

  it('keeps the active bundled Node runtime in place during repeat packaging', () => {
    const { root } = fixture();
    const resourcesRoot = join(root, 'src-tauri', 'resources');
    const nodeExecutable = join(resourcesRoot, 'node.exe');
    mkdirSync(resourcesRoot, { recursive: true });
    writeFileSync(nodeExecutable, 'fake active executable');

    prepareDesktopResources({
      moduleRoot: root,
      nodeExecutable,
      platform: 'win32',
      nodeVersion: BUNDLED_NODE_VERSION,
      architecture: 'x64',
    });

    expect(findForbiddenFiles(resourcesRoot)).toEqual([]);
  });

  it('rejects sensitive runtime files in the standalone bundle', () => {
    const { root, nodeExecutable } = fixture();
    writeFileSync(join(root, '.next', 'standalone', '.env.local'), 'SECRET=value');
    expect(() => prepareDesktopResources({
      moduleRoot: root,
      nodeExecutable,
      platform: 'win32',
      nodeVersion: BUNDLED_NODE_VERSION,
      architecture: 'x64',
    })).toThrow(/forbidden files/);
  });

  it('rejects retired launcher state from a traced legacy profile', () => {
    const { root, nodeExecutable } = fixture();
    writeFileSync(join(root, '.next', 'standalone', 'boz-instance.json'), '{"pid":1234}');
    expect(() => prepareDesktopResources({
      moduleRoot: root,
      nodeExecutable,
      platform: 'win32',
      nodeVersion: BUNDLED_NODE_VERSION,
      architecture: 'x64',
    })).toThrow(/forbidden files/);
  });
});
