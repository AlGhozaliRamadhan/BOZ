import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir } from '../utils/env-dir.js';

const INSTANCE_FILE_NAME = 'boz-instance.json';
const RESTART_FILE_NAME = 'boz-restart-request.json';

export interface BozInstance {
  pid: number;
  port: number;
  url: string;
  token: string;
}

export interface InstanceLease {
  instance: BozInstance;
  release: () => void;
}

export type AcquireInstanceResult =
  | { status: 'acquired'; lease: InstanceLease }
  | { status: 'already-running'; instance: BozInstance };

export function getInstanceFilePath(configDir = ensureConfigDir()): string {
  return join(configDir, INSTANCE_FILE_NAME);
}

export function getRestartRequestPath(configDir = ensureConfigDir()): string {
  return join(configDir, RESTART_FILE_NAME);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readInstance(instanceFile: string): BozInstance | undefined {
  if (!existsSync(instanceFile)) return undefined;
  try {
    const value = JSON.parse(readFileSync(instanceFile, 'utf8')) as Partial<BozInstance>;
    if (typeof value.pid !== 'number' || typeof value.port !== 'number' || typeof value.url !== 'string' || typeof value.token !== 'string') {
      return undefined;
    }
    return value as BozInstance;
  } catch {
    return undefined;
  }
}

export function getRunningInstance(
  instanceFile = getInstanceFilePath(),
  alive: (pid: number) => boolean = isProcessAlive,
): BozInstance | undefined {
  const instance = readInstance(instanceFile);
  if (instance && alive(instance.pid)) return instance;
  if (existsSync(instanceFile)) rmSync(instanceFile, { force: true });
  return undefined;
}

export function acquireSingleInstance(
  port: number,
  mode: 'web' | 'background',
  options: {
    instanceFile?: string;
    pid?: number;
    alive?: (pid: number) => boolean;
  } = {},
): AcquireInstanceResult {
  const instanceFile = options.instanceFile ?? getInstanceFilePath();
  const pid = options.pid ?? process.pid;
  const alive = options.alive ?? isProcessAlive;
  const instance: BozInstance = {
    pid,
    port,
    url: `http://127.0.0.1:${port}`,
    token: `${pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(instanceFile, 'wx', 0o600);
      try {
        writeFileSync(descriptor, JSON.stringify({ ...instance, mode }), 'utf8');
      } finally {
        closeSync(descriptor);
      }
      return {
        status: 'acquired',
        lease: {
          instance,
          release: () => {
            const current = readInstance(instanceFile);
            if (current?.token === instance.token) rmSync(instanceFile, { force: true });
          },
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const running = getRunningInstance(instanceFile, alive);
      if (running) return { status: 'already-running', instance: running };
    }
  }
  throw new Error('Could not claim the BOZ single-instance lock.');
}

export function requestInstanceRestart(instance: BozInstance, requestFile = getRestartRequestPath()): void {
  writeFileSync(requestFile, JSON.stringify({ token: instance.token }), { mode: 0o600 });
}

export function consumeRestartRequest(instance: BozInstance, requestFile = getRestartRequestPath()): boolean {
  if (!existsSync(requestFile)) return false;
  try {
    const request = JSON.parse(readFileSync(requestFile, 'utf8')) as { token?: unknown };
    if (request.token !== instance.token) return false;
    rmSync(requestFile, { force: true });
    return true;
  } catch {
    rmSync(requestFile, { force: true });
    return false;
  }
}

export async function waitForInstanceRestart(
  instance: BozInstance,
  options: { instanceFile?: string; timeoutMs?: number; alive?: (pid: number) => boolean } = {},
): Promise<boolean> {
  const instanceFile = options.instanceFile ?? getInstanceFilePath();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const alive = options.alive ?? isProcessAlive;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const running = getRunningInstance(instanceFile, alive);
    if (!running || running.token !== instance.token) return true;
    await new Promise((resolveP) => setTimeout(resolveP, 100));
  }
  return false;
}
