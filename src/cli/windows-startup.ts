import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureWindowsBackgroundRunner } from './background-launcher.js';

const SHORTCUT_NAME = 'BOZ.lnk';

export function getStartupShortcutPath(appData = process.env.APPDATA): string | undefined {
  return appData ? join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', SHORTCUT_NAME) : undefined;
}

export function isStartupAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && Boolean(getStartupShortcutPath());
}

export function isStartupEnabled(): boolean {
  const shortcut = getStartupShortcutPath();
  return Boolean(shortcut && existsSync(shortcut));
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function startupRunnerArguments(runner: string, nodePath: string, entryPath: string, port: number): string {
  return [runner, nodePath, entryPath, String(port)].map((value) => `"${value}"`).join(' ');
}

export function setStartupEnabled(enabled: boolean, entryPath: string, port: number): boolean {
  const shortcut = getStartupShortcutPath();
  if (!isStartupAvailable() || !shortcut) throw new Error('Start-at-sign-in is only available on Windows.');
  if (!enabled) {
    rmSync(shortcut, { force: true });
    return false;
  }

  const runner = ensureWindowsBackgroundRunner();
  const script = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$shortcut = $shell.CreateShortcut('${shortcut.replace(/'/g, "''")}')`,
    "$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'",
    `$shortcut.Arguments = '${startupRunnerArguments(runner, process.execPath, entryPath, port).replace(/'/g, "''")}'`,
    `$shortcut.WorkingDirectory = '${process.cwd().replace(/'/g, "''")}'`,
    "$shortcut.Description = 'BOZ — local dashboard in the system tray'",
    '$shortcut.WindowStyle = 7',
    '$shortcut.Save()',
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShell(script),
  ], { windowsHide: true, stdio: 'ignore' });
  if (result.error || result.status !== 0 || !existsSync(shortcut)) {
    throw new Error('Could not enable BOZ at sign-in.');
  }
  return true;
}
