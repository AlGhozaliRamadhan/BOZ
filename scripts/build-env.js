import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const out = path.join(__dirname, '..', 'dist', '.env.build');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `BOZ_VERSION=${pkg.version}\n`, 'utf8');
console.log(`Wrote ${out}`);
