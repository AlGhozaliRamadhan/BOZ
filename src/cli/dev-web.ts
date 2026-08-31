import { spawn } from 'child_process';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { waitForServer } from './wait-for-server.js';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Spawn `node <next-cli-js>` (not `node_modules/.bin/next`), which on Windows
// is a POSIX shell shim that `spawn()` without a shell cannot run. Mirrors how
// `src/cli/start-web.ts` spawns `node <standalone>/server.js`.
const NEXT_CLI = join(MODULE_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

// Long (60s) because `next dev` cold-compiles the first request (~24s), unlike
// the prebuilt standalone server in `start-web.ts`.
const DEFAULT_READY_TIMEOUT_MS = 60000;

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
  opts: { readyTimeoutMs?: number; silent?: boolean } = {},
): WebServerHandle {
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(
    process.execPath,
    [NEXT_CLI, 'dev', '--webpack', '--port', String(port), '--hostname', '127.0.0.1'],
    {
      env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
      stdio: opts.silent ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'inherit', 'inherit'],
      windowsHide: opts.silent === true,
    },
  );

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
      const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? '`next` is required for `npm run dev` — run `npm install`.'
        : `next dev failed to start: ${err.message}`;
      settle(() => rejectP(new Error(msg)));
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      if (code === 0) {
        settle(() => rejectP(new Error(`next dev exited before becoming ready (code 0, signal ${signal})`)));
      } else {
        settle(() => rejectP(new Error(`next dev exited with code ${code} signal ${signal} before becoming ready`)));
      }
    });

    waitForServer({ port, timeoutMs: readyTimeoutMs })
      .then(() => settle(resolveP))
      .catch((err) => settle(() => rejectP(err)));
  });

  return { url, port, ready, stop };
}
