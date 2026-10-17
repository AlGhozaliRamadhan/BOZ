import { configDefaults, defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    testTimeout: 20000,
    fileParallelism: false,
    // Launcher suites start real Next.js processes and contend heavily with
    // other files on Windows. Keep the canonical `npm test` gate deterministic;
    // individual tests may still run concurrent work internally.
    maxWorkers: 1,
    // `.agents/` and `.claude/` hold local agent tooling and are untracked, so
    // they are absent from a CI checkout but present on a developer machine.
    // Their `*.test.cjs` harness files are not Vitest suites, and with no
    // exclude the default glob collects them and reports "No test suite
    // found" — turning an otherwise green local gate red for a reason that
    // does not exist in CI.
    exclude: [...configDefaults.exclude, '**/.agents/**', '**/.claude/**'],
    // Same reporter, ASCII glyphs: Vitest selects its symbol set from a
    // platform check, so output otherwise differs per machine and can render
    // as mojibake wherever the font lacks the glyph.
    reporters: [path.resolve(__dirname, './scripts/vitest-ascii-reporter.ts')],
  },
});
