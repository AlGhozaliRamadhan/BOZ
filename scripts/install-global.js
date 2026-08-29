import { execSync } from 'child_process';
import { unlinkSync } from 'fs';

console.log('Building and packing BOZ...');
const output = execSync('npm pack', { encoding: 'utf8' });
const tgz = output.trim().split('\n').pop()?.trim();

if (!tgz) {
  throw new Error('npm pack did not return a package filename');
}

try {
  console.log('Installing ' + tgz + ' globally...');
  execSync('npm install -g "' + tgz + '"', { stdio: 'inherit' });
} finally {
  console.log('Cleaning up package archive...');
  unlinkSync(tgz);
}

console.log('');
console.log('BOZ installation complete.');
console.log('Run "boz" from anywhere to launch the web dashboard.');
console.log('');
