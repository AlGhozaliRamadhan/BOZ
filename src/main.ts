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
// quiet: true suppresses dotenv's "injected env" log line.
dotenv.config({ path: userEnvPath, override: false, quiet: true });
if (fs.existsSync(buildEnvPath)) dotenv.config({ path: buildEnvPath, override: false, quiet: true });

ensureConfigDir();

// Dev mode: BOZ_DEV is set by `npm run dev`, which runs this file via tsx.
// In dev we use `next dev` (live HMR) instead of the compiled standalone server.
const IS_DEV = process.env.BOZ_DEV === '1';

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
    const webMod = IS_DEV
      ? await import('./cli/dev-web.js')
      : await import('./cli/start-web.js');
    const { openBrowser } = await import('./cli/cli.js');
    const web = webMod.startWebServer(result.port);

    const cleanup = () => {
      web.stop();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => web.stop());

    try {
      await web.ready;
      openBrowser(web.url);
    } catch (err) {
      console.error('Web server error:', err instanceof Error ? err.message : String(err));
      web.stop();
      process.exit(1);
    }
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
    const webMod = IS_DEV
      ? await import('./cli/dev-web.js')
      : await import('./cli/start-web.js');
    const { openBrowser } = await import('./cli/cli.js');
    const web = webMod.startWebServer(DEFAULT_WEB_PORT);
    process.stdout.write(`  ↻ starting web server…\n`);
    try {
      await web.ready;
      process.stdout.write(`\r\x1b[K  ✓ web ready at ${web.url} — opening browser…\n`);
      openBrowser(web.url);
    } catch (err) {
      process.stdout.write(`\r\x1b[K  ✗ web server did not start: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }

    process.on('SIGINT', () => { web.stop(); process.exit(0); });
    process.on('SIGTERM', () => { web.stop(); process.exit(0); });
    return;
  }

  // The CLI REPL runs whether the picker returned 'web' or 'terminal' —
  // it is the interactive surface, and the web server (if started) warms
  // in the background.
  const { CLI } = await import('./cli/cli.js');
  const cli = new CLI();
  await cli.run();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
