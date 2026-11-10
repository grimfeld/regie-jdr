import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

export type RunningApp = {
  app: ElectronApplication;
  /** Temporary data folder the app uses as its userData for this test. */
  dataDir: string;
  /** Requests that failed in any window, as "url (error)". */
  failedRequests: string[];
  /** The Control window (the first window the app opens). */
  controlWindow: Page;
};

/** Launches the built app on `dataDir` and records failed requests in every window. */
export async function launchApp(dataDir: string): Promise<RunningApp> {
  const failedRequests: string[] = [];
  const env = { ...process.env, REGIE_USER_DATA_DIR: dataDir } as Record<string, string>;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: [repoRoot], env });
  const watch = (page: Page) => {
    page.on('requestfailed', (request) =>
      failedRequests.push(`${request.url()} (${request.failure()?.errorText})`),
    );
  };
  app.windows().forEach(watch);
  app.on('window', watch);
  const controlWindow = await app.firstWindow();
  await controlWindow.waitForLoadState('domcontentloaded');
  return { app, dataDir, failedRequests, controlWindow };
}

/** `test` with a `regie` fixture: the built app running on a fresh temporary data folder. */
export const test = base.extend<{ regie: RunningApp }>({
  regie: async ({}, use) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'regie-test-'));
    const running = await launchApp(dataDir);
    try {
      await use(running);
    } finally {
      await running.app.close().catch(() => undefined);
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  },
});

export { expect } from '@playwright/test';
