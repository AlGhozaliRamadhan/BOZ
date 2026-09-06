import { existsSync, mkdirSync, cpSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Copy .next/static into both standalone locations Next reads from.
 * Also copy public assets because Next's standalone server does not include them.
 * Returns which destinations were copied to and which sources were skipped.
 *
 * @param {{ moduleRoot: string }} opts
 * @returns {Promise<{ copied: string[]; skipped: string[]; removed: string[] }>}
 */
export async function run({ moduleRoot }) {
  const src = join(moduleRoot, '.next', 'static');
  const publicSrc = join(moduleRoot, 'public');
  const standaloneRoot = join(moduleRoot, '.next', 'standalone');
  const destA = join(standaloneRoot, '.next', 'static');
  const destB = join(standaloneRoot, 'public', '_next', 'static');
  const publicDest = join(standaloneRoot, 'public');
  const removed = [];

  mkdirSync(standaloneRoot, { recursive: true });

  if (existsSync(standaloneRoot)) {
    const sanitize = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          sanitize(entryPath);
          continue;
        }
        if ((entry.isFile() || entry.isSymbolicLink()) && (/^\.env(?:\.|$)/.test(entry.name) || entry.name.endsWith('.nft.json'))) {
          rmSync(entryPath, { force: true });
          removed.push(entryPath);
        }
      }
    };
    sanitize(standaloneRoot);
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

  if (existsSync(publicSrc)) {
    cpSync(publicSrc, publicDest, { recursive: true, force: true });
    copied.push(publicDest);
  } else {
    skipped.push('public');
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
    const removedEnvFiles = removed.filter((path) => /^\.env(?:\.|$)/.test(path.split(/[\\/]/).pop()));
    const removedTraceManifests = removed.filter((path) => path.endsWith('.nft.json'));
    for (const envPath of removedEnvFiles) {
      console.log(`✓ sanitize-standalone: ${envPath}`);
    }
    if (removedTraceManifests.length > 0) {
      console.log(`✓ sanitize-standalone: removed ${removedTraceManifests.length} Next trace manifests`);
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
