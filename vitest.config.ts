import { defineConfig } from 'vitest/config';

// App-core tests: plain Node, no Electron. Whole-app tests (*.spec.ts) run under Playwright.
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', 'tests/app/**'],
    environment: 'node',
  },
});
