import { vPick } from './cli.js';
import { getBuildVersion } from '../utils/version.js';

export const DEFAULT_WEB_PORT = 21526;

export type ModeResult =
  | { mode: 'terminal' }
  | { mode: 'web'; port: number }
  | { mode: 'version' }
  | { mode: 'help' }
  | { mode: 'pick' };

function parsePort(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function resolveMode(
  args: string[],
  env: Record<string, string> = process.env as Record<string, string>,
): ModeResult {
  const first = args[0];

  if (!first) return { mode: 'pick' };

  switch (first) {
    case 'terminal':
      return { mode: 'terminal' };
    case 'web': {
      const portFlagIdx = args.indexOf('--port');
      const port = portFlagIdx >= 0 ? parsePort(args[portFlagIdx + 1], DEFAULT_WEB_PORT) : parsePort(env.BOZ_PORT, DEFAULT_WEB_PORT);
      return { mode: 'web', port };
    }
    case '--version':
    case '-v':
      return { mode: 'version' };
    case '--help':
    case '-h':
    case 'help':
      return { mode: 'help' };
    default:
      return { mode: 'help' };
  }
}

// ─── Startup banner ───────────────────────────────────────────────────────────

const ANSI = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  ghost: '\x1b[90m',
  white: '\x1b[97m',
  cyan:  '\x1b[36m',
} as const;

const wrap = (color: string, text: string) => `${color}${text}${ANSI.reset}`;

const BOZ_LOGO = [
  '  ██              ██',
  '  ████          ████',
  '██████████████████████',
  '█████  ███████  ██████',
  '█████████   ██████████',
  '██████████████████████',
  ' ███   ███   ███   ██',
];

function printMascot(): void {
  process.stdout.write('\n');
  for (const row of BOZ_LOGO) {
    process.stdout.write(`   ${wrap(ANSI.cyan, row)}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write(
    `   ${wrap(ANSI.white, 'BOZ')}` +
    `  ${wrap(ANSI.ghost, '· Behavioral Outlook Zone')}` +
    `  ${wrap(ANSI.dim, 'v' + getBuildVersion())}\n\n`,
  );
}

export async function pickMode(): Promise<'terminal' | 'web'> {
  printMascot();
  process.stdout.write(
    `   ${wrap(ANSI.ghost, 'How would you like to use BOZ?')}\n\n`,
  );
  const idx = await vPick(['Terminal', 'Web UI'], 0, '   ');
  process.stdout.write('\n');
  return idx === 0 ? 'terminal' : 'web';
}

export function printUsage(): void {
  process.stdout.write(
    `BOZ v${getBuildVersion()} — Behavioral Outlook Zone\n` +
    `Usage: boz [terminal|web|--version|--help]\n` +
    `  boz              choose Terminal or Web UI\n` +
    `  boz terminal     open the terminal CLI\n` +
    `  boz web          start the dashboard and open the browser\n` +
    `  boz web --port N use port N (default ${DEFAULT_WEB_PORT})\n` +
    `  boz --version    print version\n` +
    `  boz --help       show this help\n\n`,
  );
}
