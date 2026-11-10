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
  /** Content security policy violations reported in any window's console. */
  cspViolations: string[];
  /** The Control window (the first window the app opens). */
  controlWindow: Page;
};

/** Launches the built app on `dataDir` and records failed requests in every window. */
export async function launchApp(dataDir: string): Promise<RunningApp> {
  const failedRequests: string[] = [];
  const cspViolations: string[] = [];
  const app = await electron.launch({ args: [repoRoot], env: appEnv(dataDir) });
  const watch = (page: Page) => {
    page.on('requestfailed', (request) =>
      failedRequests.push(`${request.url()} (${request.failure()?.errorText})`),
    );
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) cspViolations.push(message.text());
    });
  };
  app.windows().forEach(watch);
  app.on('window', watch);
  const controlWindow = await app.firstWindow();
  await controlWindow.waitForLoadState('domcontentloaded');
  return { app, dataDir, failedRequests, cspViolations, controlWindow };
}

/** Environment for a built-app process running on `dataDir`. */
export function appEnv(dataDir: string): Record<string, string> {
  const env = { ...process.env, REGIE_USER_DATA_DIR: dataDir } as Record<string, string>;
  delete env.VITE_DEV_SERVER_URL;
  return env;
}

/** Path of the built app, as passed to the Electron executable. */
export const appPath = repoRoot;

/** Replaces the native file picker in the main process: the next pickers return `filePaths`. */
export async function stubFilePicker(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    const picked = async () => ({ canceled: false, filePaths: paths });
    dialog.showOpenDialog = picked as typeof dialog.showOpenDialog;
  }, filePaths);
}

/** Path of a file in tests/app/fixtures. */
export function fixture(name: string): string {
  return path.join(__dirname, 'fixtures', name);
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
