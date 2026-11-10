import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { BrowserWindow } from 'electron';
import {
  createCampaign,
  expect,
  launchApp,
  openBroadcastWindow,
  test,
  type RunningApp,
} from './harness';

/** Restarts the app on the same data folder; the caller closes the returned app. */
async function restart(running: RunningApp): Promise<RunningApp> {
  await running.app.close();
  return launchApp(running.dataDir);
}

function theme(page: Page) {
  return page.locator('html');
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boundsOf(app: ElectronApplication, page: Page): Promise<Bounds> {
  const window = await app.browserWindow(page);
  return window.evaluate((w: BrowserWindow) => w.getNormalBounds());
}

async function moveWindow(app: ElectronApplication, page: Page, bounds: Bounds): Promise<Bounds> {
  const window = await app.browserWindow(page);
  await window.evaluate((w: BrowserWindow, b) => {
    w.setBounds(b);
  }, bounds);
  return boundsOf(app, page);
}

test('the home page theme is remembered across restarts; a Campaign keeps its own theme', async ({
  regie,
}) => {
  const home = regie.controlWindow;
  await expect(home.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
  await expect(theme(home)).toHaveAttribute('data-theme', 'imperium');
  await home.getByLabel('Thème de l’accueil').selectOption({ label: 'Fantasy' });
  await expect(theme(home)).toHaveAttribute('data-theme', 'fantasy');

  const restarted = await restart(regie);
  try {
    const page = restarted.controlWindow;
    await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
    await expect(theme(page)).toHaveAttribute('data-theme', 'fantasy');
    await expect(page.getByLabel('Thème de l’accueil')).toHaveValue('fantasy');

    // Inside a Campaign, the Campaign's own theme applies; back home, the global one.
    await createCampaign(page, 'Warhammer');
    await expect(theme(page)).toHaveAttribute('data-theme', 'imperium');
    await page.getByRole('button', { name: 'Campagnes' }).click();
    await expect(theme(page)).toHaveAttribute('data-theme', 'fantasy');
  } finally {
    await restarted.app.close();
  }
});

test('the Control and Broadcast windows reopen where and as large as they were left', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const control = await moveWindow(app, controlWindow, { x: 40, y: 30, width: 1100, height: 720 });
  const broadcast = await moveWindow(app, broadcastWindow, {
    x: 200,
    y: 120,
    width: 960,
    height: 540,
  });

  const restarted = await restart(regie);
  try {
    expect(await boundsOf(restarted.app, restarted.controlWindow)).toEqual(control);
    const reopened = await openBroadcastWindow(restarted.app, restarted.controlWindow);
    expect(await boundsOf(restarted.app, reopened)).toEqual(broadcast);
  } finally {
    await restarted.app.close();
  }
});

test('a window saved on a display that is gone reopens on the screen', async ({ regie }) => {
  const { app, dataDir } = regie;
  await app.close();
  await fs.writeFile(
    path.join(dataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 1,
      theme: 'imperium',
      windowBounds: { control: { x: -40000, y: -40000, width: 1100, height: 720 } },
      lastActiveSceneByCampaign: {},
    }),
  );

  const restarted = await launchApp(dataDir);
  try {
    const workArea = await restarted.app.evaluate(
      ({ screen }) => screen.getPrimaryDisplay().workArea,
    );
    const bounds = await boundsOf(restarted.app, restarted.controlWindow);
    // The saved size is kept; only the position is brought back.
    expect({ width: bounds.width, height: bounds.height }).toEqual({ width: 1100, height: 720 });
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x);
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
  } finally {
    await restarted.app.close();
  }
});

test('after a restart nothing is on air, and the last Active Scene is highlighted', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  const scenes = controlWindow.getByRole('region', { name: 'Scènes' });
  for (const name of ['Cantina', 'Hangar']) {
    await scenes.getByLabel('Nom de la scène').fill(name);
    await scenes.getByRole('button', { name: 'Créer la scène' }).click();
    await expect(
      controlWindow.getByRole('region', { name: 'Scène ouverte' }).getByRole('heading', { name }),
    ).toBeVisible();
  }
  // Hangar is the Selected Scene: Activate it.
  const editor = controlWindow.getByRole('region', { name: 'Scène ouverte' });
  await editor.getByRole('button', { name: 'Activer' }).click();
  await expect(editor).toContainText('Scène active');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastWindow.locator('main.broadcast-screen')).not.toHaveAttribute(
    'data-active-scene-id',
    '',
  );

  const restarted = await restart(regie);
  try {
    // The only Campaign opens directly.
    const page = restarted.controlWindow;
    const list = page.getByRole('list', { name: 'Scènes de la campagne' });
    const hangar = list.getByRole('listitem').filter({ hasText: 'Hangar' });
    const cantina = list.getByRole('listitem').filter({ hasText: 'Cantina' });
    await expect(hangar).toContainText('Dernière active');
    // Highlighted, not on air.
    await expect(hangar.locator('.scene-active-badge')).toHaveCount(0);
    await expect(cantina).not.toContainText('Dernière active');

    const reopened = await openBroadcastWindow(restarted.app, page);
    await expect(reopened.locator('main.broadcast-screen')).toHaveAttribute(
      'data-active-scene-id',
      '',
    );
    await expect(reopened.locator('.canvas-background')).toHaveCount(0);
  } finally {
    await restarted.app.close();
  }
});
