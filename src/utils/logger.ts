// ─── ANSI Color Palette ───────────────────────────────────────────────────────

const R = '\x1b[0m';

export const clr = {
  reset:   R,
  dim:     (s: string) => `\x1b[2m${s}${R}`,
  ghost:   (s: string) => `\x1b[90m${s}${R}`,
  white:   (s: string) => `\x1b[97m${s}${R}`,
  green:   (s: string) => `\x1b[32m${s}${R}`,
  yellow:  (s: string) => `\x1b[33m${s}${R}`,
  red:     (s: string) => `\x1b[31m${s}${R}`,
  cyan:    (s: string) => `\x1b[36m${s}${R}`,
  blue:    (s: string) => `\x1b[34m${s}${R}`,
  magenta: (s: string) => `\x1b[35m${s}${R}`,
} as const;

// ─── Badge factory ────────────────────────────────────────────────────────────
// badge('ok')      → green   [ok]
// badge('warn')    → yellow  [warn]
// badge('error')   → red     [error]
// badge('info')    → dim     [info]
// badge('data')    → cyan    [data]
// badge('ai')      → magenta [ai]
// badge('news')    → blue    [news]
// badge('crowd')   → yellow  [crowd]
// badge(label, color) → any custom badge

export type BadgeColor =
  | 'green' | 'yellow' | 'red' | 'cyan'
  | 'blue' | 'magenta' | 'white' | 'dim' | 'ghost';

const PRESET: Record<string, BadgeColor> = {
  ok:       'green',
  warn:     'yellow',
  warning:  'yellow',
  error:    'red',
  err:      'red',
  info:     'dim',
  data:     'cyan',
  ai:       'magenta',
  news:     'blue',
  crowd:    'yellow',
  calc:     'dim',
  chart:    'white',
  mtf:      'white',
  macro:    'white',
  validate: 'dim',
  realtime: 'cyan',
  yahoo:    'cyan',
  compare:  'ghost',
};

export function badge(label: string, color?: BadgeColor): string {
  const col = color ?? PRESET[label.toLowerCase()] ?? 'dim';
  const fn  = clr[col] as (s: string) => string;
  return fn(`[${label}]`);
}

// ─── Convenience singletons ───────────────────────────────────────────────────

export const OK   = badge('ok');
export const WARN = badge('warn');
export const ERR  = badge('error');
export const INFO = badge('info');

// ─── Horizontal rules ─────────────────────────────────────────────────────────

export const hr  = (char = '─', w = 72) => clr.dim(char.repeat(w));
export const hr2 = (w = 72)             => clr.dim('━'.repeat(w));

// ─── Service log helpers ──────────────────────────────────────────────────────
// Consistent one-liner status lines used across all services.
// Format:  "  [badge]  label     message"
//
// CLR: when a spinner is active it holds the cursor at the end of the spinner
// text (no newline). Without CLR, service logs would append to the spinner
// line. \r\x1b[K moves to col 0 and clears the current line before writing.

const CLR = (process.stdout.isTTY ?? true) ? '\r\x1b[K' : '';
const LW  = 10; // label column width

export const log = {
  ok   : (label: string, msg: string) =>
    console.log (`${CLR}  ${badge('ok')}    ${clr.dim(label.padEnd(LW))} ${msg}`),
  warn : (label: string, msg: string) =>
    console.log (`${CLR}  ${badge('warn')}  ${clr.yellow(label.padEnd(LW))} ${clr.yellow(msg)}`),
  error: (label: string, msg: string) =>
    console.error(`${CLR}  ${badge('error')} ${clr.red(label.padEnd(LW))} ${clr.red(msg)}`),
  info : (label: string, msg: string) =>
    console.log (`${CLR}  ${badge('info')}   ${clr.dim(label.padEnd(LW))} ${clr.dim(msg)}`),
  data : (label: string, msg: string) =>
    console.log (`${CLR}  ${badge('data')}   ${clr.dim(label.padEnd(LW))} ${msg}`),
  ai   : (label: string, msg: string) =>
    console.log (`${CLR}  ${badge('ai')}     ${clr.dim(label.padEnd(LW))} ${msg}`),
  news : (label: string, msg: string) =>
    console.log (`${CLR}  ${badge('news')}   ${clr.dim(label.padEnd(LW))} ${msg}`),
  crowd: (label: string, msg: string) =>
    console.log (`${CLR}  ${badge('crowd')}  ${clr.dim(label.padEnd(LW))} ${msg}`),
};
