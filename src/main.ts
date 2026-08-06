#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ensureConfigDir, configEnvPath } from './utils/env-dir.js';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildEnvPath = path.join(moduleRoot, '.env.build');
const userEnvPath = configEnvPath();

// Load env in priority order: per-user ~/.boz/.env, then package template, then process env.
dotenv.config({ path: userEnvPath, override: false });
if (fs.existsSync(buildEnvPath)) dotenv.config({ path: buildEnvPath, override: false });

ensureConfigDir();

const { resolveMode, pickMode, printUsage, DEFAULT_WEB_PORT } = await import('./cli/mode.js');

async function main(): Promise<void> {
  const result = resolveMode(process.argv.slice(2));
  const mode = result.mode;

  if (mode === 'version') {
    const { getBuildVersion } = await import('./utils/version.js');
    console.log(`BOZ v${getBuildVersion()}`);
    process.exit(0);
  }
  if (mode === 'help') {
    printUsage();
    process.exit(0);
  }
  if (mode === 'web') {
    const { startWebServer } = await import('./cli/start-web.js');
    await startWebServer(result.port);
    return;
  }
  if (mode === 'terminal') {
    const { CLI } = await import('./cli/cli.js');
    const cli = new CLI();
    await cli.run();
    return;
  }
  // mode === 'pick'
  if (!process.stdin.isTTY) {
    printUsage();
    process.exit(1);
  }
  const chosen = await pickMode();
  if (chosen === 'web') {
    const { startWebServer } = await import('./cli/start-web.js');
    await startWebServer(DEFAULT_WEB_PORT);
  } else {
    const { CLI } = await import('./cli/cli.js');
    const cli = new CLI();
    await cli.run();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
