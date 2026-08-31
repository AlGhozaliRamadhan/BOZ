#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ensureConfigDir, configEnvPath } from './utils/env-dir.js';

const entryPath = fileURLToPath(import.meta.url);
const moduleRoot = path.resolve(path.dirname(entryPath), '..');
const buildEnvPath = path.join(moduleRoot, '.env.build');
const userEnvPath = configEnvPath();

dotenv.config({ path: userEnvPath, override: false, quiet: true });
if (fs.existsSync(buildEnvPath)) dotenv.config({ path: buildEnvPath, override: false, quiet: true });
ensureConfigDir();

const IS_DEV = process.env.BOZ_DEV === '1';
const { resolveMode, printUsage } = await import('./cli/mode.js');

async function runWebServer(port: number, backgroundChild = false): Promise<void> {
  const { openBrowser } = await import('./cli/open-browser.js');
  const { startSystemTray } = await import('./cli/system-tray.js');
  const { reportBackgroundReady } = await import('./cli/background-launcher.js');
  const { acquireSingleInstance, consumeRestartRequest } = await import('./cli/single-instance.js');
  const startup = await import('./cli/windows-startup.js');
  const webModule = IS_DEV ? await import('./cli/dev-web.js') : await import('./cli/start-web.js');
  const claim = acquireSingleInstance(port, backgroundChild ? 'background' : 'web');
  if (claim.status === 'already-running') {
    if (backgroundChild) throw new Error(`BOZ is already running at ${claim.instance.url}.`);
    openBrowser(claim.instance.url);
    console.log(`BOZ is already running at ${claim.instance.url}.`);
    return;
  }
  const lease = claim.lease;
  process.title = backgroundChild ? 'BOZ Background' : 'BOZ';
  const web = webModule.startWebServer(port, { silent: backgroundChild });
  let tray: Awaited<ReturnType<typeof startSystemTray>> | undefined;
  let shuttingDown = false;
  let changingStartup = false;
  let restartWatcher: NodeJS.Timeout | undefined;
  const startupAvailable = !IS_DEV && startup.isStartupAvailable();
  let startupEnabled = startupAvailable && startup.isStartupEnabled();

  const cleanup = () => {
    if (restartWatcher) clearInterval(restartWatcher);
    tray?.stop();
    web.stop();
    lease.release();
  };
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanup();
    process.exit(code);
  };
  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));
  process.once('exit', cleanup);
  restartWatcher = setInterval(() => {
    if (consumeRestartRequest(lease.instance)) shutdown(0);
  }, 250);

  try {
    await web.ready;
    if (!backgroundChild) {
      openBrowser(web.url);
      console.log(`BOZ is running at ${web.url}. Press Ctrl+C to stop it.`);
      return;
    }

    const createTray = async (): Promise<void> => {
      tray = await startSystemTray({
        url: web.url,
        startupAvailable,
        startupEnabled,
        onExit: () => shutdown(0),
        onToggleStartup: () => {
          if (changingStartup) return;
          changingStartup = true;
          void (async () => {
            try {
              startupEnabled = startup.setStartupEnabled(!startupEnabled, entryPath, port);
              tray?.stop();
              tray = undefined;
              await createTray();
            } catch {
              // Keep BOZ running; a failed shortcut operation changes no tray state.
            } finally {
              changingStartup = false;
            }
          })();
        },
        onUnexpectedExit: () => shutdown(1),
      });
    };
    await createTray();
    reportBackgroundReady(web.url);
  } catch (error) {
    cleanup();
    throw new Error('Web server failed: ' + (error instanceof Error ? error.message : String(error)));
  }
}

async function launchBackground(port: number): Promise<void> {
  const { getRunningInstance } = await import('./cli/single-instance.js');
  const { launchInBackground } = await import('./cli/background-launcher.js');
  const { openBrowser } = await import('./cli/open-browser.js');
  const existing = getRunningInstance();
  if (existing) {
    openBrowser(existing.url);
    console.log(`BOZ is already running at ${existing.url}.`);
    return;
  }
  await launchInBackground(entryPath, port);
  console.log('BOZ is running in the system tray.');
}

async function main(): Promise<void> {
  const result = resolveMode(process.argv.slice(2));
  if (result.mode === 'version') {
    const { getBuildVersion } = await import('./utils/version.js');
    console.log('BOZ v' + getBuildVersion());
    return;
  }
  if (result.mode === 'help') return printUsage();
  if (result.mode === 'background-child') return runWebServer(result.port, true);
  if (result.mode === 'background') return launchBackground(result.port);
  if (result.mode === 'web') return runWebServer(result.port);
  const { createLauncherInfo, selectExistingSessionAction, selectLauncherAction } = await import('./cli/launcher-ui.js');
  const { getRunningInstance, requestInstanceRestart, waitForInstanceRestart } = await import('./cli/single-instance.js');
  const { openBrowser } = await import('./cli/open-browser.js');
  const existing = getRunningInstance();
  const action = await selectLauncherAction(createLauncherInfo(result.port));
  if (action === 'exit') return;
  if (existing) {
    const sessionAction = await selectExistingSessionAction(existing.url);
    if (sessionAction === 'leave-running') return;
    if (sessionAction === 'open-existing') {
      openBrowser(existing.url);
      return;
    }
    requestInstanceRestart(existing);
    const stopped = await waitForInstanceRestart(existing);
    if (!stopped) throw new Error('BOZ did not stop its current session. Leave it running or exit it from the system tray, then try again.');
  }
  if (action === 'background') return launchBackground(result.port);
  return runWebServer(result.port);
}

main().catch(async (error) => {
  if (process.argv.includes('--background-child')) {
    const { reportBackgroundError } = await import('./cli/background-launcher.js');
    reportBackgroundError(error);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
