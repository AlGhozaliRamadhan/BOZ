#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Copy .next/static into both standalone locations Next reads from.
 * Returns which destinations were copied to and which sources were skipped.
 *
 * @param {{ moduleRoot: string }} opts
 * @returns {Promise<{ copied: string[]; skipped: string[] }>}
 */
export async function run({ moduleRoot }) {
  const src = join(moduleRoot, '.next', 'static');
  const destA = join(moduleRoot, '.next', 'standalone', '.next', 'static');
  const destB = join(moduleRoot, '.next', 'standalone', 'public', '_next', 'static');

  if (!existsSync(src)) {
    return { copied: [], skipped: ['.next/static'] };
  }

  const copied = [];
  for (const dest of [destA, destB]) {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    copied.push(dest);
  }

  return { copied, skipped: [] };
}

// CLI wrapper: run when invoked directly (`node scripts/copy-static.js`).
// Resolve moduleRoot as the repo root, two levels up from this script.
const isCli = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isCli) {
  const moduleRoot = resolve(__dirname, '..', '..');
  try {
    const { copied, skipped } = await run({ moduleRoot });
    for (const dest of copied) {
      console.log(`✓ copy-static: ${dest}`);
    }
    for (const name of skipped) {
      console.log(`↻ copy-static: ${name} not found (run \`npm run build\` first) — skipping`);
    }
    process.exit(0);
  } catch (err) {
    console.warn(`⚠ copy-static: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(0);
  }
}
