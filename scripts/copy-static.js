#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Copy .next/static into both standalone locations Next reads from.
 * Returns which destinations were copied to and which sources were skipped.
 *
 * @param {{ moduleRoot: string }} opts
 * @returns {Promise<{ copied: string[]; skipped: string[]; removed: string[] }>}
 */
export async function run({ moduleRoot }) {
  const src = join(moduleRoot, '.next', 'static');
  const standaloneRoot = join(moduleRoot, '.next', 'standalone');
  const destA = join(standaloneRoot, '.next', 'static');
  const destB = join(standaloneRoot, 'public', '_next', 'static');
  const removed = [];

  mkdirSync(standaloneRoot, { recursive: true });

  if (existsSync(standaloneRoot)) {
    for (const entry of readdirSync(standaloneRoot, { withFileTypes: true })) {
      if (entry.isFile() && /^\.env(?:\.|$)/.test(entry.name)) {
        const envPath = join(standaloneRoot, entry.name);
        rmSync(envPath, { force: true });
        removed.push(envPath);
      }
    }
  }

  const copied = [];
  const skipped = [];

  if (existsSync(src)) {
    for (const dest of [destA, destB]) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true, force: true });
      copied.push(dest);
    }
  } else {
    skipped.push('.next/static');
  }

  const serverJsPath = join(standaloneRoot, 'server.js');
  if (!existsSync(serverJsPath)) {
    const serverCode = `process.env.NODE_ENV = 'production';
const path = require('path');
const fs = require('fs');

process.chdir(__dirname);

const currentPort = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || '127.0.0.1';

const requiredServerFilesPath = fs.existsSync(path.join(__dirname, '.next', 'required-server-files.json'))
  ? path.join(__dirname, '.next', 'required-server-files.json')
  : fs.existsSync(path.join(__dirname, '..', 'required-server-files.json'))
  ? path.join(__dirname, '..', 'required-server-files.json')
  : path.join(__dirname, 'required-server-files.json');

const nextConfig = fs.existsSync(requiredServerFilesPath) ? require(requiredServerFilesPath).config : {};
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

const rootDir = fs.existsSync(path.join(__dirname, '..', '..', '.next'))
  ? path.resolve(__dirname, '..', '..')
  : __dirname;

const { startServer } = require('next/dist/server/lib/start-server');

startServer({
  dir: rootDir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
    writeFileSync(serverJsPath, serverCode, 'utf8');
    copied.push(serverJsPath);
  }

  return { copied, skipped, removed };
}

// CLI wrapper: run when invoked directly (`node scripts/copy-static.js`).
// Resolve moduleRoot as the repo root, one level up from this script.
const isCli = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isCli) {
  const moduleRoot = resolve(__dirname, '..');
  try {
    const { copied, skipped, removed } = await run({ moduleRoot });
    for (const envPath of removed) {
      console.log(`✓ sanitize-standalone: ${envPath}`);
    }
    for (const dest of copied) {
      console.log(`✓ copy-static: ${dest}`);
    }
    for (const name of skipped) {
      console.log(`↻ copy-static: ${name} not found (run \`npm run build\` first) — skipping`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`✗ copy-static: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
