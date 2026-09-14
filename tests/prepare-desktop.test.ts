import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertBundledNode,
  BUNDLED_NODE_VERSION,
  findForbiddenFiles,
  prepareDesktopResources,
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
