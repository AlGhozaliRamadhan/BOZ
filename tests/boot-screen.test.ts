import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The boot screen shipped as a static page with a 42%-wide div sliding back and
// forth forever: no percentage, no stage, no version, and an aria-hidden bar on
// a page whose aria-live region never changed. The host now writes it through
// webview eval, so the ids it writes must exist and the page must stay
// script-free (the desktop CSP is script-src 'none').

const boot = readFileSync('src-tauri/loading/index.html', 'utf8');
const host = readFileSync('src-tauri/src/lib.rs', 'utf8');

describe('boot screen markup', () => {
  it('exposes every element the host writes to', () => {
    for (const id of ['stage', 'track', 'bar', 'pct', 'version', 'slow', 'hint']) {
      expect(boot, `boot page is missing #${id}`).toContain(`id="${id}"`);
    }
  });

  it('has no script surface during boot', () => {
    expect(boot).not.toMatch(/<script/i);
    expect(boot).not.toMatch(/\son[a-z]+\s*=/i);
    expect(boot).not.toMatch(/javascript:/i);
    // The host writes the page through webview eval instead of a script tag.
    expect(host).toContain('render_boot_progress');
    expect(host).toContain('window.eval(&script)');
  });

  it('announces progress to assistive tech instead of hiding it', () => {
    expect(boot).toContain('role="progressbar"');
    expect(boot).toContain('aria-valuemin="0"');
    expect(boot).toContain('aria-valuemax="100"');
    expect(boot).toContain('aria-valuenow=');
    // The old markup hid the bar from screen readers entirely.
    expect(boot).not.toMatch(/aria-hidden="true"[^>]*class="track"/);
    expect(boot).toContain('aria-live="polite"');
    expect(boot).toContain('aria-labelledby="stage"');
  });

  it('does not animate the bar once the host has taken over', () => {
    // The pre-hydration crawl must stop, otherwise real progress fights a
    // CSS animation that keeps overwriting the width.
    expect(boot).toContain('.hosted .bar');
    expect(host).toContain("classList.add('hosted')");
  });
});

describe('boot screen branding', () => {
  it('uses the same logo as the app', () => {
    // The loading page keeps its own copy because it is shipped as a static
    // frontendDist asset with no build step. Nothing synced it, so it silently
    // stayed on the v2.5 mark while public/ moved to the new one.
    const digest = (path: string) =>
      createHash('sha256').update(readFileSync(path)).digest('hex');
    expect(digest('src-tauri/loading/logo-boz-transparant-white.png'))
      .toBe(digest('public/logo-boz-transparant-white.png'));
  });

  it('takes its colors from the dark-mode design tokens', () => {
    // The boot screen used a dead cyan brand (#080b0d / #3bd8ee / #e8f7fb) that
    // the app itself abandoned. tokens.css declares the light overrides first
    // (html[data-theme='light']) and the dark palette in the base :root after
    // it — dark is the default, so the base block is the one that matters.
    const tokens = readFileSync('src/app/styles/tokens.css', 'utf8');
    expect(tokens).toMatch(/Violet-Graphite Monochrome/);

    const base = tokens.slice(tokens.lastIndexOf(':root {'));
    const token = (name: string) => {
      const match = base.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
      expect(match, `tokens.css dark block is missing --${name}`).not.toBeNull();
      return match![1].toLowerCase();
    };

    expect(boot).toContain(`--bg-primary:    ${token('bg-primary')}`);
    expect(boot).toContain(`--border-glass:  ${token('border-glass')}`);
    expect(boot).toContain(`--text-primary:  ${token('text-primary')}`);
    expect(boot).toContain(`--text-secondary:${token('text-secondary')}`);
    expect(boot).toContain(`--text-muted:    ${token('text-muted')}`);
    // The accent really is white in dark mode; the bar must match it.
    expect(token('accent-cyan')).toBe('#ffffff');
    expect(boot).toContain(`--accent:        ${token('accent-cyan')}`);
  });

  it('has no leftover color from the dead cyan brand', () => {
    // Scan declarations only: the file's own comments name the dead values on
    // purpose, to explain why they are gone.
    const declarations = boot
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .toLowerCase();
    for (const dead of ['#080b0d', '#3bd8ee', '#e8f7fb', '#8ca4aa', '#5d757b', '#4f676d']) {
      expect(declarations, `boot screen still uses ${dead}`).not.toContain(dead);
    }
  });
});

describe('boot progress from the host', () => {
  it('names real stages instead of one frozen sentence', () => {
    expect(host).toContain('Starting the local market server');
    expect(host).toContain('Starting your private market workspace');
    expect(host).toContain('Workspace ready');
  });

  it('keeps progress below 100 until the health check actually answers', () => {
    // The bar must never claim completion before the server is ready.
    expect(host).toContain('88.0 * fraction.sqrt()');
    expect(host).toContain('as u8');
  });

  it('tells the user when a slow first launch is still working', () => {
    expect(host).toContain('BOZ_SLOW_START_AFTER');
    expect(host).toContain('slow: elapsed >= BOZ_SLOW_START_AFTER.as_secs_f64()');
    expect(boot).toContain('First launch takes a little longer');
  });

  it('escapes every value written into the page', () => {
    expect(host).toContain('fn js_string(value: &str) -> String');
    expect(host).toContain('serde_json::to_string(value)');
  });
});