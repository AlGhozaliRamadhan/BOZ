import { execSync } from 'child_process';
import fs from 'fs';

console.log('Packing application...');
const output = execSync('npm pack', { encoding: 'utf8' });
const tgz = output.trim().split('\n').pop().trim();

console.log(`Installing ${tgz} globally...`);
execSync(`npm install -g ${tgz}`, { stdio: 'inherit' });

console.log('Cleaning up...');
fs.unlinkSync(tgz);

console.log('\n=========================================');
console.log('Installation complete!');
console.log('The "boz" command has been saved to your global npm directory (AppData).');
console.log('You can now run "boz" from anywhere, and it no longer depends on this folder.');
console.log('=========================================\n');
