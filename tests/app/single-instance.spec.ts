import type { ElectronApplication } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appEnv, appPath, expect, launchApp, test } from './harness';

// The `electron` package resolves to the path of the Electron executable.
const electronExecutable = require('electron') as unknown as string;

/** Starts the app a second time, as the Game Master would, and resolves with its exit code. */
function launchAgain(dataDir: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const second = spawn(electronExecutable, [appPath], { env: appEnv(dataDir), stdio: 'ignore' });
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('the second launch kept running'));
    }, 20_000);
    second.on('error', reject);
    second.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** The app's only window, the Control window: whether it is visible, minimized, and how many. */
function controlWindowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return {
      count: windows.length,
      visible: windows[0].isVisible(),
      minimized: windows[0].isMinimized(),
    };
  });
}

test('launching the app again shows the existing Control window instead of starting a second app', async ({
  regie,
}) => {
  const { app, dataDir } = regie;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await expect.poll(async () => (await controlWindowState(app)).visible).toBe(false);

  const exitCode = await launchAgain(dataDir);

  expect(exitCode).toBe(0);
  await expect.poll(() => controlWindowState(app)).toMatchObject({ count: 1, visible: true });
});

test('launching the app again restores a minimized Control window', async ({ regie }) => {
  // Under xvfb (Linux CI) there is no window manager: minimize() does nothing there.
  test.skip(process.platform === 'linux', 'minimizing needs a window manager');
  const { app, dataDir } = regie;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expect.poll(async () => (await controlWindowState(app)).minimized).toBe(true);

  const exitCode = await launchAgain(dataDir);

  expect(exitCode).toBe(0);
  await expect
    .poll(() => controlWindowState(app))
    .toMatchObject({ count: 1, visible: true, minimized: false });
});

test('apps running on different data folders do not block each other', async ({ regie }) => {
  const otherDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'regie-test-'));
  const other = await launchApp(otherDataDir);
  try {
    await expect(other.controlWindow.getByText('POSTE DU MAÎTRE DU JEU')).toBeVisible();
    await expect(regie.controlWindow.getByText('POSTE DU MAÎTRE DU JEU')).toBeVisible();
  } finally {
    await other.app.close().catch(() => undefined);
    await fs.rm(otherDataDir, { recursive: true, force: true });
  }
});
