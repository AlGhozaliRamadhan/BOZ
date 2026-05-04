// ─── Shared display utilities for all analyzers ───────────────────────────────
// Extracted from analyzers to avoid duplication. Import these instead of
// defining ln / row / section / sep / pctColor locally in each analyzer.

import { clr, badge, hr, hr2, BadgeColor } from './logger.js';

// ─── Basic print ──────────────────────────────────────────────────────────────

export const ln = (s = '') => console.log(s);

// ─── Row: "  [label]  value" ──────────────────────────────────────────────────

export function row(label: string, value: string, labelColor?: BadgeColor): void {
  ln(`  ${badge(label, labelColor)}  ${value}`);
}

// ─── Section header with heavy rule ──────────────────────────────────────────

export function section(label: string, title: string, color: BadgeColor = 'white'): void {
  ln('');
  ln(hr2());
  ln(`  ${badge(label, color)}  ${clr.white(title)}`);
  ln(hr2());
}

// ─── Thin separator ───────────────────────────────────────────────────────────

export function sep(): void { ln(hr()); }

// ─── Percentage colorizer ─────────────────────────────────────────────────────

export function pctColor(pct: number, decimals = 2): string {
  const s = (pct > 0 ? '+' : '') + pct.toFixed(decimals) + '%';
  return pct > 0 ? clr.green(s) : pct < 0 ? clr.red(s) : clr.dim(s);
}

// ─── RSI color ────────────────────────────────────────────────────────────────

export function rsiColor(rsi: number): (s: string) => string {
  if (rsi > 70) return clr.red;
  if (rsi < 30) return clr.green;
  return clr.dim;
}

export function rsiLabel(rsi: number): string {
  if (rsi > 80) return 'EXTREME OVERBOUGHT';
  if (rsi > 70) return 'OVERBOUGHT';
  if (rsi < 20) return 'EXTREME OVERSOLD';
  if (rsi < 30) return 'OVERSOLD';
  return 'NEUTRAL';
}

// ─── Confidence color ─────────────────────────────────────────────────────────

export function confColor(conf: number): string {
  if (conf >= 75) return clr.green(conf + '%');
  if (conf >= 50) return clr.yellow(conf + '%');
  return clr.red(conf + '%');
}

// ─── Volume classification color ──────────────────────────────────────────────

export function volClassColor(cls: string): string {
  if (cls === 'EXTREME' || cls === 'VERY_HIGH') return clr.green(cls);
  if (cls === 'HIGH') return clr.yellow(cls);
  return clr.dim(cls);
}

// ─── OBV signal color ─────────────────────────────────────────────────────────

export function obvColor(signal: string): string {
  if (signal === 'ACCUMULATION') return clr.green(signal);
  if (signal === 'DISTRIBUTION') return clr.red(signal);
  return clr.dim(signal);
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
// Usage:
//   const stop = spinner('  [data]  Fetching price data');
//   await doWork();
//   stop('ok' | 'warn' | 'err', 'optional override message');

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinner(prefix: string): (status: 'ok' | 'warn' | 'err', msg?: string) => void {
  let i      = 0;
  const isTTY = process.stdout.isTTY ?? true; // treat non-TTY as TTY-like for npm run dev
  const start = Date.now();

  process.stdout.write(`${prefix}  ${isTTY ? '\x1b[2m' + FRAMES[0] + '\x1b[0m' : '…'}`);
  if (!isTTY) process.stdout.write('\n');

  const tid = isTTY
    ? setInterval(() => {
        i = (i + 1) % FRAMES.length;
        process.stdout.write(`\r\x1b[K${prefix}  \x1b[2m${FRAMES[i]}\x1b[0m`);
      }, 80)
    : null;

  return (status: 'ok' | 'warn' | 'err', msg?: string) => {
    if (tid) clearInterval(tid);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const icon =
      status === 'ok'   ? clr.green('✔') :
      status === 'warn' ? clr.yellow('⚠') :
                          clr.red('✖');
    const suffix = msg ? `  ${clr.dim(msg)}` : '';
    const time   = clr.dim(`  ${elapsed}s`);
    if (isTTY) {
      process.stdout.write(`\r\x1b[K${prefix}  ${icon}${suffix}${time}\n`);
    } else {
      process.stdout.write(`${prefix}  ${icon}${suffix}${time}\n`);
    }
  };
}
