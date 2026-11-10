import { defineConfig } from 'vitest/config';

// App-core tests: plain Node, no Electron; component tests (*.test.tsx) opt into jsdom per file.
// Whole-app tests (*.spec.ts) run under Playwright.
export default defineConfig({
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      '.claude/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'tests/app/**',
    ],
    environment: 'node',
  },
  // Component tests (*.test.tsx) use React's automatic JSX runtime, as the app does.
  esbuild: {
    jsx: 'automatic',
  },
});
