import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir } from '../utils/env-dir.js';

const DEFAULT_BACKGROUND_TIMEOUT_MS = 75_000;
const RUNNER_FILE_NAME = 'boz-background-launcher.vbs';

export interface BackgroundLaunchResult {
  pid: number;
  url: string;
}

interface BackgroundStatus {
  type: 'ready' | 'error';
  pid?: number;
  url?: string;
  message?: string;
}

export function backgroundChildArgs(entryPath: string, port: number): string[] {
  return [entryPath, '--background-child', '--port', String(port)];
}

/** Starts Node with WScript so Windows never opens a console for background BOZ. */
export function ensureWindowsBackgroundRunner(): string {
  const runnerPath = join(ensureConfigDir(), RUNNER_FILE_NAME);
  const script = [
    'Option Explicit',
    'Dim shell, args, command, readyFile',
    'Set shell = CreateObject("WScript.Shell")',
    'Set args = WScript.Arguments',
    'If args.Count < 3 Then WScript.Quit 87',
    'readyFile = ""',
    'If args.Count > 3 Then readyFile = args(3)',
    'If readyFile <> "" Then shell.Environment("PROCESS")("BOZ_BACKGROUND_READY_FILE") = readyFile',
    'command = Chr(34) & args(0) & Chr(34) & " " & Chr(34) & args(1) & Chr(34) & " --background-child --port " & args(2)',
    'shell.Run command, 0, False',
  ].join('\r\n');
  if (!existsSync(runnerPath) || readFileSync(runnerPath, 'utf8') !== script) {
    writeFileSync(runnerPath, script, 'utf8');
  }
  return runnerPath;
}

function readStatus(statusFile: string): BackgroundStatus | undefined {
  if (!existsSync(statusFile)) return undefined;
  try {
    return JSON.parse(readFileSync(statusFile, 'utf8')) as BackgroundStatus;
  } catch {
    return { type: 'error', message: 'BOZ background startup returned an invalid status.' };
  }
}

export function launchInBackground(
  entryPath: string,
  port: number,
  timeoutMs = DEFAULT_BACKGROUND_TIMEOUT_MS,
): Promise<BackgroundLaunchResult> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Background tray mode is currently available on Windows only.'));
  }

  const statusFile = join(ensureConfigDir(), `boz-background-${process.pid}-${Date.now()}.json`);
  const runner = ensureWindowsBackgroundRunner();
  const child = spawn('wscript.exe', [runner, process.execPath, entryPath, String(port), statusFile], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();

  return new Promise<BackgroundLaunchResult>((resolveP, rejectP) => {
    const startedAt = Date.now();
    const finish = (error?: Error, value?: BackgroundLaunchResult) => {
      clearInterval(timer);
      try { rmSync(statusFile, { force: true }); } catch { /* best-effort cleanup */ }
      if (error) rejectP(error);
      else resolveP(value!);
    };
    const timer = setInterval(() => {
      const status = readStatus(statusFile);
      if (status?.type === 'error') {
        finish(new Error(status.message ?? 'BOZ could not start in the system tray.'));
      } else if (status?.type === 'ready' && status.url && status.pid) {
        finish(undefined, { url: status.url, pid: status.pid });
      } else if (Date.now() - startedAt >= timeoutMs) {
        finish(new Error(`BOZ did not become ready in the system tray within ${timeoutMs}ms.`));
      }
    }, 100);
    child.once('error', (error) => finish(new Error(`Could not launch BOZ in the background: ${error.message}`)));
  });
}

function writeStatus(status: BackgroundStatus): void {
  const statusFile = process.env.BOZ_BACKGROUND_READY_FILE;
  if (statusFile) writeFileSync(statusFile, JSON.stringify(status), 'utf8');
}

export function reportBackgroundReady(url: string): void {
  writeStatus({ type: 'ready', pid: process.pid, url });
}

export function reportBackgroundError(error: unknown): void {
  writeStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
