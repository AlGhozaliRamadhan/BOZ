#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ensureConfigDir, configEnvPath } from './utils/env-dir.js';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildEnvPath = path.join(moduleRoot, '.env.build');
const userEnvPath = configEnvPath();

// Load per-user settings first, followed by build metadata. Existing process
// variables always win so hosted and container environments remain predictable.
dotenv.config({ path: userEnvPath, override: false, quiet: true });
if (fs.existsSync(buildEnvPath)) {
  dotenv.config({ path: buildEnvPath, override: false, quiet: true });
}

ensureConfigDir();

// npm run dev uses the same web-only launcher with a Next.js development
// server. Published packages use the bundled standalone production server.
const IS_DEV = process.env.BOZ_DEV === '1';

const { resolveMode, printUsage } = await import('./cli/mode.js');

async function main(): Promise<void> {
  const result = resolveMode(process.argv.slice(2));

  if (result.mode === 'version') {
    const { getBuildVersion } = await import('./utils/version.js');
    console.log('BOZ v' + getBuildVersion());
    return;
  }

  if (result.mode === 'help') {
    printUsage();
    return;
  }

  const webModule = IS_DEV
    ? await import('./cli/dev-web.js')
    : await import('./cli/start-web.js');
  const { openBrowser } = await import('./cli/open-browser.js');
  const web = webModule.startWebServer(result.port);

  const cleanup = () => {
    web.stop();
  };

  process.once('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.once('exit', cleanup);

  process.stdout.write('Starting BOZ web dashboard on port ' + result.port + '...\n');

  try {
    await web.ready;
    process.stdout.write('BOZ is ready at ' + web.url + '\n');
    openBrowser(web.url);
  } catch (error) {
    cleanup();
    throw new Error(
      'Web server failed: ' + (error instanceof Error ? error.message : String(error)),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
