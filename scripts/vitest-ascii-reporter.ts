/**
 * ASCII-only Vitest reporter.
 *
 * Wraps Vitest's own `DefaultReporter` and sanitizes everything on its way to
 * the terminal. Two reasons this is a wrapper rather than a config flag:
 *
 *   • Vitest picks its glyphs from a platform check (`process.platform ===
 *     'win32'` selects ASCII-ish, everything else selects `✔ ✖ › ─`), so the
 *     same repo renders differently per machine and per CI image. Neither set
 *     is guaranteed to be what the terminal's font can draw.
 *   • There is no supported option to override the symbol table, and patching
 *     `node_modules` would be undone by the next `npm ci`.
 *
 * Substituting in the logger keeps the default reporter's layout, timings, and
 * failure diffs exactly as upstream renders them — only the glyphs change.
 *
 * Replacements are chosen to stay meaningful: pass/fail are distinguished by
 * text (`PASS`/`FAIL`) rather than by a lone character, and arrows/bullets map
 * to ASCII equivalents so column alignment is preserved.
 */

import type { Reporter } from 'vitest/node';

/** Glyph → ASCII. Only the characters Vitest's reporters actually emit. */
const GLYPHS: ReadonlyArray<readonly [RegExp, string]> = [
  // Status marks. `PASS`/`FAIL` carry the meaning; the mark is redundant.
  [/[✔✓]/gu, 'PASS'],
  [/[✖✗✘×]/gu, 'FAIL'],
  [/⏭/gu, 'SKIP'],
  [/⚠/gu, 'WARN'],
  [/ℹ/gu, 'INFO'],
  // Structure.
  [/[─━]/gu, '-'],
  [/[›»]/gu, '>'],
  [/❯/gu, '>'],
  [/[∙•·]/gu, '*'],
  [/[‣▪▫]/gu, '-'],
  [/…/gu, '...'],
  [/[←-⇿↑↓]/gu, (glyph) => (glyph === '↑' ? '^' : glyph === '↓' ? 'v' : '<')],
];

/**
 * Replace every non-ASCII character that has no mapping with a neutral one,
 * so an unexpected upstream glyph degrades to a placeholder instead of
 * rendering as mojibake.
 */
function toAscii(input: string): string {
  let output = input;
  for (const [pattern, replacement] of GLYPHS) {
    output = output.replace(pattern, replacement);
  }
  return output
    // Box drawing, braille, and geometric shapes carry no meaning we can
    // preserve in ASCII; a space keeps indentation and column width.
    .replace(/[^\x20-\x7E\n\t]/gu, ' ');
}

/**
 * Load `DefaultReporter` at runtime.
 *
 * This file is itself loaded through Vite's module runner, which cannot resolve
 * `vitest/node` statically from inside the reporter graph. `module` names are
 * therefore held for later and `@vite-ignore` keeps the import native so Node
 * resolves them normally.
 */
type VitestReporterApi = { DefaultReporter: new () => Reporter };
let apiPromise: Promise<VitestReporterApi> | null = null;

function loadReporterApi(): Promise<VitestReporterApi> {
  apiPromise ??= import(/* @vite-ignore */ 'vitest/node') as Promise<VitestReporterApi>;
  return apiPromise;
}

/** Forwards every hook to whichever reporter has been constructed. */
function forward<K extends keyof Reporter>(
  hooks: K[],
  getInner: () => Reporter | null,
): Pick<Reporter, K> {
  const bound = {} as Record<string, unknown>;
  for (const hook of hooks) {
    bound[hook] = (...args: unknown[]) => {
      const inner = getInner();
      const method = inner?.[hook];
      if (typeof method === 'function') return (method as (...a: unknown[]) => unknown).apply(inner, args);
      return undefined;
    };
  }
  return bound as Pick<Reporter, K>;
}

const FORWARDED_HOOKS = [
  'onTestRunStart', 'onTestRunEnd', 'onTestModuleQueued', 'onTestModuleCollected',
  'onTestModuleEnd', 'onTestCaseReady', 'onTestCaseResult', 'onHookStart',
  'onHookEnd', 'onWatcherStart', 'onWatcherRerun', 'onCoverage',
] as const satisfies ReadonlyArray<keyof Reporter>;

export class AsciiReporter implements Reporter {
  private inner: Reporter | null = null;

  constructor() {
    // The wrapped reporter is resolved before the run starts and installed by
    // `onInit`, so hooks delegated to it are safe to declare up front.
    Object.assign(this, forward([...FORWARDED_HOOKS], () => this.inner));
  }

  async onInit(ctx: Parameters<NonNullable<Reporter['onInit']>>[0]): Promise<void> {
    // Sanitize at the logger so every path DefaultReporter uses — progress,
    // summaries, stack traces, diffs — is covered by one hook.
    const logger = ctx.logger;
    for (const method of ['log', 'error', 'warn'] as const) {
      const original = logger[method].bind(logger);
      logger[method] = (...args: unknown[]): void => {
        (original as (...values: unknown[]) => void)(
          ...args.map((arg) => (typeof arg === 'string' ? toAscii(arg) : arg)),
        );
      };
    }
    const { DefaultReporter } = await loadReporterApi();
    this.inner = new DefaultReporter();
    this.inner.onInit?.(ctx);
  }
}

export default AsciiReporter;