import { defineConfig } from 'vitest/config';
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
    // Launcher suites start real Next.js processes and contend heavily with
    // other files on Windows. Keep the canonical `npm test` gate deterministic;
    // individual tests may still run concurrent work internally.
    maxWorkers: 1,
  },
});
