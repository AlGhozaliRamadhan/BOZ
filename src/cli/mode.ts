import { getBuildVersion } from '../utils/version.js';

export const DEFAULT_WEB_PORT = 21526;

export type ModeResult =
  | { mode: 'web'; port: number }
  | { mode: 'version' }
  | { mode: 'help' };

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function resolvePort(
  args: string[],
  env: Record<string, string | undefined>,
): number {
  const envPort = parsePort(env.BOZ_PORT, DEFAULT_WEB_PORT);
  const portFlagIndex = args.indexOf('--port');
  return portFlagIndex >= 0
    ? parsePort(args[portFlagIndex + 1], envPort)
    : envPort;
}

export function resolveMode(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): ModeResult {
  const first = args[0];

  if (!first || first === 'web' || first === '--port') {
    return { mode: 'web', port: resolvePort(args, env) };
  }

  if (first === '--version' || first === '-v') {
    return { mode: 'version' };
  }

  return { mode: 'help' };
}

export function printUsage(): void {
  process.stdout.write(
    'BOZ v' + getBuildVersion() + ' — web market intelligence\n' +
    'Usage: boz [web] [--port N]\n\n' +
    '  boz              start the web dashboard and open a browser\n' +
    '  boz web          alias for the default web launch\n' +
    '  boz --port N     use port N (default ' + DEFAULT_WEB_PORT + ')\n' +
    '  boz --version    print version\n' +
    '  boz --help       show this help\n\n',
  );
}
