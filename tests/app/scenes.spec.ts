import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

/** The Scenes panel of the open Campaign. */
function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

/** The editor of the Selected Scene. */
function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

async function importImage({ app, controlWindow }: RunningApp) {
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    controlWindow.getByRole('list', { name: 'Médias' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
}

/** Creates a Scene from the Scenes panel; it becomes the Selected Scene. */
async function createScene(page: Page, name: string) {
  await scenesPanel(page).getByLabel('Nom de la scène').fill(name);
  await scenesPanel(page).getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

async function selectScene(page: Page, name: string) {
  await scenesPanel(page)
    .getByRole('list', { name: 'Scènes de la campagne' })
    .getByRole('button', { name, exact: true })
    .click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Places the imported image as a Background of the Selected Scene (it starts Hidden). */
async function addBackground(page: Page) {
  await editor(page).getByLabel('Image à placer').selectOption({ label: IMAGE });
  await editor(page).getByRole('button', { name: 'Ajouter en arrière-plan' }).click();
  await expect(backgroundToggle(page)).toBeVisible();
}

function backgroundToggle(page: Page) {
  return editor(page)
    .getByRole('list', { name: 'Arrière-plans' })
    .getByRole('checkbox', { name: `Afficher ${IMAGE}` });
}

/** Background images the Broadcast window shows (loaded, so not hidden). */
function shownBackgrounds(broadcastWindow: Page) {
  return broadcastWindow.locator('main.broadcast-screen .broadcast-layer img:not([hidden])');
}

function broadcastScreen(broadcastWindow: Page) {
  return broadcastWindow.locator('main.broadcast-screen');
}

test('Activate puts the Scene on air, and editing it updates the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow, cspViolations, failedRequests } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('Scène active');
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');
  // The new Background is Hidden: it never reaches the Broadcast window.
  await expect(broadcastWindow.locator('.broadcast-layer')).toHaveCount(0);

  await backgroundToggle(controlWindow).check();
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);
  expect(
    await shownBackgrounds(broadcastWindow).evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(16);

  await backgroundToggle(controlWindow).uncheck();
  await expect(broadcastWindow.locator('.broadcast-layer')).toHaveCount(0);
  await backgroundToggle(controlWindow).check();
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);

  expect(cspViolations).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('a Scene with a Background, edited while active, is kept after a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('Scène active');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await backgroundToggle(controlWindow).check();
  // The main process saves the edit before it puts it on air.
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    // The only Campaign opens directly; nothing is on air after a restart.
    const page = restarted.controlWindow;
    await selectScene(page, 'Cantina');
    await expect(backgroundToggle(page)).toBeChecked();
    await expect(editor(page)).not.toContainText('Scène active');
    const broadcastWindow = await openBroadcastWindow(restarted.app, page);
    await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
    await expect(broadcastWindow.locator('.broadcast-layer')).toHaveCount(0);
  } finally {
    await restarted.app.close();
  }
});

test('editing a Scene that is not active never changes the Broadcast window', async ({ regie }) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('Scène active');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');
  const version = await broadcastScreen(broadcastWindow).getAttribute('data-version');

  await createScene(controlWindow, 'Hangar');
  await expect(editor(controlWindow)).not.toContainText('Scène active');
  await addBackground(controlWindow);
  await backgroundToggle(controlWindow).check();
  await expect(backgroundToggle(controlWindow)).toBeChecked();
  // The edit is saved (read back through the Control bridge).
  await expect
    .poll(() =>
      controlWindow.evaluate(async () => {
        const { regie } = window as unknown as {
          regie: {
            listScenes(
              id: string,
            ): Promise<{ name: string; backgrounds: { visible: boolean }[] }[]>;
          };
        };
        const onAir = await (
          window as unknown as { regie: { getOnAir(): Promise<{ campaignId: string }> } }
        ).regie.getOnAir();
        const scenes = await regie.listScenes(onAir.campaignId);
        return scenes.find((scene) => scene.name === 'Hangar')?.backgrounds[0]?.visible;
      }),
    )
    .toBe(true);

  // A round trip through the Broadcast bridge, then two frames: any change has arrived.
  await broadcastWindow.evaluate(async () => {
    await (window as unknown as { regie: { getOnAir(): Promise<unknown> } }).regie.getOnAir();
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
  });
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-version', version ?? '');
  await expect(broadcastWindow.locator('.broadcast-layer')).toHaveCount(0);
});

test('opening a Campaign puts nothing on air; switching Campaign clears the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  await backgroundToggle(controlWindow).check();
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(shownBackgrounds(broadcastWindow)).toHaveCount(1);
  // Every on-air change from here on, as the Broadcast window receives it.
  await broadcastWindow.evaluate(() => {
    const bridge = (window as unknown as { regie: { onStopAudio(l: () => void): void } }).regie;
    const record = window as unknown as { audioStops: number };
    record.audioStops = 0;
    bridge.onStopAudio(() => record.audioStops++);
  });
  const audioStops = () =>
    broadcastWindow.evaluate(() => (window as unknown as { audioStops: number }).audioStops);

  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(controlWindow, 'Warhammer');
  await expect(broadcastWindow.locator('.broadcast-layer')).toHaveCount(0);
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  await expect.poll(audioStops).toBe(2); // back to the list, then into Warhammer

  // Back into Star Wars: nothing goes on air until a Scene is Activated.
  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await controlWindow
    .getByRole('list', { name: 'Campagnes' })
    .getByRole('button', { name: 'Star Wars', exact: true })
    .click();
  await selectScene(controlWindow, 'Cantina');
  await expect(editor(controlWindow)).not.toContainText('Scène active');
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-active-scene-id', '');
  await expect(broadcastWindow.locator('.broadcast-layer')).toHaveCount(0);
});

test('a Background whose file was deleted shows nothing broken in the Broadcast window', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir, cspViolations } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await addBackground(controlWindow);
  await backgroundToggle(controlWindow).check();
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('Scène active');

  const [campaignId] = await fs.readdir(path.join(dataDir, 'campaigns'));
  const mediaFolder = path.join(dataDir, 'campaigns', campaignId, 'media');
  for (const file of await fs.readdir(mediaFolder)) await fs.rm(path.join(mediaFolder, file));

  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');
  await expect(broadcastWindow.locator('.broadcast-layer')).toHaveCount(1);
  // The 404 leaves no <img> to show a broken-image icon.
  await expect(broadcastWindow.locator('.broadcast-layer img')).toHaveCount(0);
  expect(cspViolations).toEqual([]);
});
