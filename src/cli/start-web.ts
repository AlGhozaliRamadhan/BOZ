import { spawn } from 'child_process';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { waitForServer } from './wait-for-server.js';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFAULT_READY_TIMEOUT_MS = 30_000;

export interface WebServerHandle {
  url: string;
  port: number;
  /** Resolves when the server returns 2xx on `/`, rejects on timeout or child error. */
  ready: Promise<void>;
  /** Stops the child process. Idempotent. */
  stop: () => void;
}

export function startWebServer(
  port: number,
  opts: { readyTimeoutMs?: number } = {},
): WebServerHandle {
  const serverPath = join(MODULE_ROOT, '.next', 'standalone', 'server.js');
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}`;

  const child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (child.pid) {
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        } catch {
          if (!child.killed) child.kill();
        }
      } else {
        if (!child.killed) child.kill('SIGTERM');
      }
    }
  };

  const ready = new Promise<void>((resolveP, rejectP) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    child.on('error', (err) => {
      settle(() => rejectP(new Error(`web server failed to start: ${err.message}`)));
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      if (code === 0) {
        settle(() => rejectP(new Error(`web server exited before becoming ready (code 0, signal ${signal})`)));
      } else {
        settle(() => rejectP(new Error(`web server exited with code ${code} signal ${signal} before becoming ready`)));
      }
    });

    waitForServer({ port, timeoutMs: readyTimeoutMs })
      .then(() => settle(resolveP))
      .catch((err) => settle(() => rejectP(err)));
  });

  return { url, port, ready, stop };
}
