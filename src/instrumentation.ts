/**
 * Next calls `register()` once per server instance, before the instance starts
 * serving. That is the only boot hook BOZ has, and it is where the per-user
 * settings file has to be read: the desktop sidecar inherits the OS environment
 * and runs with its working directory inside the bundled server, so Next's own
 * dotenv loader never sees `<config dir>/.env`.
 *
 * Without this, a provider saved in Settings applied until the next launch and
 * was then replaced by whatever the ambient environment implied.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // `require` rather than `import`: Next folds this comparison per runtime and
  // drops the branch, so the node-only loader never reaches the edge bundle.
  // A dynamic `import()` here is still bundled for both runtimes and fails on
  // the edge one with "Can't resolve 'path'".
  const { registerUserSettingsEnv } = require('./instrumentation.node') as typeof import('./instrumentation.node');
  registerUserSettingsEnv();
}
