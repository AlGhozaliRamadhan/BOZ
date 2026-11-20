import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('../src/app/components/ui/ThoughtAccordion.module.css', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');

/** One CSS rule body, so assertions cannot accidentally match a neighbour. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

// The reported bug: the expanded web-source list painted the browser's default
// light control over the dark theme. These are the declarations that prevent
// it, pinned at the rule that owns them.

describe('web search source styling', () => {
  it('resets the toggle button to a plain text control', () => {
    // "Show N more sources" is a real <button>. Without a reset the UA paints
    // its background, border and padding — the white box.
    const toggle = ruleBody('.web-search-source-toggle');
    expect(toggle).toContain('border: 0');
    expect(toggle).toContain('background: transparent');
    expect(toggle).toContain('padding:');
    expect(toggle).toContain('color: var(--text-secondary');
  });

  it('gives source rows the app border, radius and hover treatment', () => {
    const row = ruleBody('.web-search-source');
    expect(row).toContain('border: 1px solid var(--border-glass)');
    expect(row).toContain('border-radius: var(--radius-md)');
    expect(row).toContain('padding:');
    // Theme tokens, not the white accent, so light mode stays readable.
    expect(row).not.toContain('var(--accent-cyan)');

    const hover = ruleBody('.web-search-source:hover');
    expect(hover).toContain('var(--border-glass-hover)');
    expect(hover).toContain('var(--bg-tertiary)');
  });

  it('keeps the favicon tile on a theme surface', () => {
    const favicon = ruleBody('.web-search-source-favicon');
    expect(favicon).toContain('var(--bg-tertiary');
  });
});
