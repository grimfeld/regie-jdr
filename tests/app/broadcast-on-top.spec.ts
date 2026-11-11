import type { ElectronApplication, Page } from '@playwright/test';
import type { BrowserWindow } from 'electron';
import { expect, launchApp, openBroadcastWindow, test } from './harness';

async function isAlwaysOnTop(app: ElectronApplication, page: Page): Promise<boolean> {
  const window = await app.browserWindow(page);
  return window.evaluate((w: BrowserWindow) => w.isAlwaysOnTop());
}

function onTopToggle(controlWindow: Page) {
  return controlWindow.getByRole('button', { name: 'Toujours au premier plan' });
}

test('"Toujours au premier plan" keeps the Broadcast window above the Control window, across a restart', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const toggle = onTopToggle(controlWindow);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await isAlwaysOnTop(app, broadcastWindow)).toBe(false);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => isAlwaysOnTop(app, broadcastWindow)).toBe(true);
  // Only the Broadcast window: the Control window can go behind it.
  expect(await isAlwaysOnTop(app, controlWindow)).toBe(false);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => isAlwaysOnTop(app, broadcastWindow)).toBe(false);

  // Turned on with the Broadcast window closed: the next one opens on top.
  await broadcastWindow.close();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const reopened = await openBroadcastWindow(app, controlWindow);
  expect(await isAlwaysOnTop(app, reopened)).toBe(true);

  await app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    await expect(onTopToggle(restarted.controlWindow)).toHaveAttribute('aria-pressed', 'true');
    const broadcast = await openBroadcastWindow(restarted.app, restarted.controlWindow);
    expect(await isAlwaysOnTop(restarted.app, broadcast)).toBe(true);
    expect(await isAlwaysOnTop(restarted.app, restarted.controlWindow)).toBe(false);
  } finally {
    await restarted.app.close();
  }
});

test('the Broadcast window shows no control for staying on top', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(onTopToggle(controlWindow)).toBeVisible();
  await expect(broadcastWindow.getByRole('button')).toHaveCount(0);
  await expect(broadcastWindow.getByText('premier plan')).toHaveCount(0);
});
