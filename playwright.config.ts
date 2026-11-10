import { defineConfig } from '@playwright/test';

// Whole-app tests launch the built Electron app: run `npm run build` first.
export default defineConfig({
  testDir: 'tests/app',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
