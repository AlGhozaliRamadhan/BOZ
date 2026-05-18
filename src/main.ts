#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(moduleRoot, '.env');
const buildEnvPath = path.join(moduleRoot, '.env.build');
const selectedEnv = fs.existsSync(envPath) ? envPath : buildEnvPath;

dotenv.config({ path: selectedEnv, override: true }); // Always read env from the build folder.

const { CLI } = await import('./cli/cli.js');

const cli = new CLI();
cli.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
