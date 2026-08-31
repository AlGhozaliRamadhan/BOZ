import readline from 'node:readline';
import { getBuildVersion } from '../utils/version.js';
import type { UpdateCheckResult } from '../utils/update-check.js';

export type LauncherAction = 'web' | 'background' | 'exit';
export type ExistingSessionAction = 'open-existing' | 'restart' | 'leave-running';

export interface LauncherInfo {
  port: number;
  version: string;
  providerStatus: string;
  updateInfo?: UpdateCheckResult | null;
}

function hasProviderConfiguration(env: NodeJS.ProcessEnv): boolean {
  const provider = env.AI_PROVIDER?.toLowerCase();
  if (provider === 'github') return Boolean(env.GITHUB_TOKEN);
  if (provider === 'nvidia') return Boolean(env.NVIDIA_API_KEY);
  if (provider === 'custom') return Boolean(env.CUSTOM_AI_URL);
  if (provider === 'offline') return Boolean(env.OFFLINE_AI_URL);
  return Boolean(env.GITHUB_TOKEN || env.NVIDIA_API_KEY || env.CUSTOM_AI_URL || env.OFFLINE_AI_URL);
}

export function createLauncherInfo(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  updateInfo: UpdateCheckResult | null = null,
): LauncherInfo {
  return {
    port,
    version: getBuildVersion(),
    providerStatus: hasProviderConfiguration(env) ? 'Configured' : 'Needs setup',
    updateInfo,
  };
}

function color(code: number, value: string): string {
  return `\u001B[${code}m${value}\u001B[0m`;
}

function choicesFor(): Array<[string, string, string, LauncherAction]> {
  return [
    ['O', 'Open web dashboard', 'Start BOZ here and open your browser'],
    ['B', 'Run in background', 'Keep BOZ available from the system tray'],
    ['Q', 'Exit', 'Close without starting BOZ'],
  ].map(([key, label, description]) => [key, label, description, key === 'O' ? 'web' : key === 'B' ? 'background' : 'exit']);
}

export function renderLauncher(info: LauncherInfo, selected: number): string {
  const choices = choicesFor();
  const width = 78;
  const line = '─'.repeat(width - 2);
  const boxLine = (content = '', tone?: number) => {
    const body = content.slice(0, width - 2).padEnd(width - 2);
    return `│${tone ? color(tone, body) : body}│`;
  };
  const row = (label: string, value: string) => boxLine(`  ${label.padEnd(16)}${value}`);
  const menu = choices.map(([key, label, description], index) => {
    const body = `  ${index === selected ? '›' : ' '} [${key}] ${label.padEnd(29)}${description}`;
    return boxLine(body, index === selected ? 97 : 90);
  });
  const updateBanner = info.updateInfo?.updateAvailable ? [
    boxLine(`  ★ UPDATE AVAILABLE: v${info.updateInfo.latestVersion} (current: v${info.version})`, 93),
    boxLine(`    Run '${info.updateInfo.updateCommand}' to update`, 96),
    `├${line}┤`,
  ] : [];
  return [
    `┌${line}┐`,
    boxLine(`  BOZ  BEHAVIORAL OUTLOOK ZONE  v${info.version}`, 97),
    boxLine('  Local AI market intelligence • private by default', 90),
    `├${line}┤`,
    ...updateBanner,
    row('Dashboard', `http://127.0.0.1:${info.port}`),
    row('AI setup', info.providerStatus),
    row('Runtime', `${process.version}  •  ${process.env.NODE_ENV === 'production' ? 'Production' : 'Local'}`),
    row('Desktop', 'Windows tray available'),
    `├${line}┤`,
    boxLine('  Choose how you want to launch BOZ', 97),
    boxLine(),
    ...menu,
    boxLine(),
    boxLine('  Use ↑/↓ and Enter, or press the highlighted shortcut.', 90),
    `└${line}┘`,
  ].join('\n');
}

function redraw(output: NodeJS.WriteStream, block: string, previousLines: number): number {
  if (previousLines > 0) {
    readline.moveCursor(output, 0, -previousLines);
    readline.cursorTo(output, 0);
    readline.clearScreenDown(output);
  }
  output.write(block + '\n');
  return block.split('\n').length;
}

export async function selectLauncherAction(info: LauncherInfo): Promise<LauncherAction> {
  const choices = choicesFor();
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'web';
  let selected = 0;
  let renderedLines = redraw(process.stdout, renderLauncher(info, selected), 0);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<LauncherAction>((resolveP) => {
    const finish = (action: LauncherAction) => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolveP(action);
    };
    const onKeypress = (_input: string, key: readline.Key) => {
      if (key.name === 'up') selected = (selected + choices.length - 1) % choices.length;
      else if (key.name === 'down') selected = (selected + 1) % choices.length;
      else if (key.name === 'return') return finish(choices[selected][3]);
      else if (key.name) {
        const selectedChoice = choices.find(([shortcut]) => shortcut.toLowerCase() === key.name);
        if (selectedChoice) return finish(selectedChoice[3]);
        if (key.ctrl && key.name === 'c') return finish('exit');
        return;
      }
      else return;
      renderedLines = redraw(process.stdout, renderLauncher(info, selected), renderedLines);
    };
    process.stdin.on('keypress', onKeypress);
  });
}

function renderExistingSessionPrompt(url: string, selected: number): string {
  const choices: Array<[string, string, string]> = [
    ['O', 'Open existing dashboard', 'Keep the current BOZ session'],
    ['R', 'Restart with a new session', 'Close it cleanly, then start again'],
    ['L', 'Leave it running', 'Return without changing anything'],
  ];
  const width = 78;
  const line = '─'.repeat(width - 2);
  const boxLine = (content = '', tone?: number) => {
    const body = content.slice(0, width - 2).padEnd(width - 2);
    return `│${tone ? color(tone, body) : body}│`;
  };
  return [
    `┌${line}┐`,
    boxLine('  BOZ is already running', 97),
    boxLine(`  ${url}`, 90),
    `├${line}┤`,
    ...choices.map(([key, label, description], index) => boxLine(
      `  ${index === selected ? '›' : ' '} [${key}] ${label.padEnd(29)}${description}`,
      index === selected ? 97 : 90,
    )),
    `└${line}┘`,
  ].join('\n');
}

export async function selectExistingSessionAction(url: string): Promise<ExistingSessionAction> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'open-existing';
  const choices: Array<[string, ExistingSessionAction]> = [
    ['o', 'open-existing'], ['r', 'restart'], ['l', 'leave-running'],
  ];
  let selected = 0;
  let renderedLines = redraw(process.stdout, renderExistingSessionPrompt(url, selected), 0);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<ExistingSessionAction>((resolveP) => {
    const finish = (action: ExistingSessionAction) => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolveP(action);
    };
    const onKeypress = (_input: string, key: readline.Key) => {
      if (key.name === 'up') selected = (selected + choices.length - 1) % choices.length;
      else if (key.name === 'down') selected = (selected + 1) % choices.length;
      else if (key.name === 'return') return finish(choices[selected][1]);
      else if (key.name) {
        const choice = choices.find(([shortcut]) => shortcut === key.name);
        if (choice) return finish(choice[1]);
        if (key.ctrl && key.name === 'c') return finish('leave-running');
        return;
      } else return;
      renderedLines = redraw(process.stdout, renderExistingSessionPrompt(url, selected), renderedLines);
    };
    process.stdin.on('keypress', onKeypress);
  });
}
