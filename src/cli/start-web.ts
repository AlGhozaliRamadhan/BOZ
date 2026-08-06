import { spawn } from 'child_process';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { openBrowser } from './cli.js';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function waitForServer(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`Server did not start on port ${port} within ${timeoutMs}ms`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

export async function startWebServer(port: number): Promise<void> {
  const serverPath = join(MODULE_ROOT, '.next', 'standalone', 'server.js');
  const child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  child.on('error', (err) => {
    console.error(`Failed to start web server: ${err.message}`);
    process.exit(1);
  });

  try {
    await waitForServer(port, 15000);
  } catch (err) {
    child.kill();
    console.error(`Web server did not start: ${(err as Error).message}`);
    process.exit(1);
  }

  const url = `http://127.0.0.1:${port}`;
  console.log(`BOZ dashboard running at ${url}`);
  openBrowser(url);

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
    process.exit(0);
  });
}
