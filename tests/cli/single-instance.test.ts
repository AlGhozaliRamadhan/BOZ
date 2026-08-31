import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireSingleInstance, consumeRestartRequest, getRunningInstance, requestInstanceRestart } from '../../src/cli/single-instance.js';

describe('single-instance guard', () => {
  it('returns the existing BOZ instance instead of creating a duplicate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'boz-instance-'));
    const instanceFile = join(directory, 'boz-instance.json');
    try {
      const first = acquireSingleInstance(21526, 'background', { instanceFile, pid: 7001, alive: () => true });
      expect(first.status).toBe('acquired');
      const second = acquireSingleInstance(21526, 'background', { instanceFile, pid: 7002, alive: () => true });
      expect(second).toMatchObject({ status: 'already-running', instance: { pid: 7001, port: 21526 } });
      if (first.status === 'acquired') first.lease.release();
      expect(getRunningInstance(instanceFile, () => true)).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('replaces a stale instance file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'boz-instance-'));
    const instanceFile = join(directory, 'boz-instance.json');
    try {
      const old = acquireSingleInstance(21526, 'web', { instanceFile, pid: 6001, alive: () => true });
      expect(old.status).toBe('acquired');
      const replacement = acquireSingleInstance(21527, 'web', { instanceFile, pid: 6002, alive: (pid) => pid === 6002 });
      expect(replacement).toMatchObject({ status: 'acquired', lease: { instance: { pid: 6002, port: 21527 } } });
      if (replacement.status === 'acquired') replacement.lease.release();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts restart requests only from the matching instance token', () => {
    const directory = mkdtempSync(join(tmpdir(), 'boz-instance-'));
    const instanceFile = join(directory, 'boz-instance.json');
    const requestFile = join(directory, 'restart.json');
    try {
      const claimed = acquireSingleInstance(21526, 'background', { instanceFile, pid: 7001, alive: () => true });
      if (claimed.status !== 'acquired') throw new Error('test could not claim instance');
      requestInstanceRestart(claimed.lease.instance, requestFile);
      expect(consumeRestartRequest({ ...claimed.lease.instance, token: 'different' }, requestFile)).toBe(false);
      expect(consumeRestartRequest(claimed.lease.instance, requestFile)).toBe(true);
      claimed.lease.release();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
