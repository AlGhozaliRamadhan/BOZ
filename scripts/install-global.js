import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('Packing application...');
const output = execSync('npm pack', { encoding: 'utf8' });
const tgz = output.trim().split('\n').pop().trim();

console.log(`Installing ${tgz} globally...`);
execSync(`npm install -g ${tgz}`, { stdio: 'inherit' });

try {
	const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
	const moduleDir = path.join(globalRoot, 'boz');
	const targetEnv = path.join(moduleDir, '.env');

	const freshEnv = [
		'GITHUB_TOKEN=',
		'NVIDIA_API_KEY=',
		'AI_PROVIDER=',
		'',
	].join('\n');

	if (fs.existsSync(moduleDir)) {
		fs.writeFileSync(targetEnv, freshEnv, 'utf8');
		console.log(`Wrote fresh runtime env to ${targetEnv}`);
	} else {
		console.warn(`Warning: global module path not found (${moduleDir})`);
	}
} catch (err) {
	console.warn(`Warning: could not write env files to global module (${err.message ?? err})`);
}

console.log('Cleaning up...');
fs.unlinkSync(tgz);

console.log('\n=========================================');
console.log('Installation complete!');
console.log('The "boz" command has been saved to your global npm directory (AppData).');
console.log('You can now run "boz" from anywhere, and it no longer depends on this folder.');
console.log('=========================================\n');
