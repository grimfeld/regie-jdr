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

test('launching the app again brings the existing Control window forward instead of starting a second app', async ({
  regie,
}) => {
  const { app, dataDir } = regie;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
    .toBe(true);

  const exitCode = await launchAgain(dataDir);

  expect(exitCode).toBe(0);
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
    .toBe(false);
  const windowCount = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
  );
  expect(windowCount).toBe(1);
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
