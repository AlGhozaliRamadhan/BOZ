import { existsSync, mkdirSync, rmSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const distDir = resolve(projectRoot, 'dist');

if (dirname(distDir) !== projectRoot || basename(distDir) !== 'dist') {
  throw new Error('Refusing to clean an unexpected output path: ' + distDir);
}

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

console.log('Cleaned ' + distDir);
