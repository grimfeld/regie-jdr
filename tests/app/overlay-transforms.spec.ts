import type { Locator, Page } from '@playwright/test';
import type { Campaign, Scene } from '../../shared/domain';
import {
  createCampaign,
  dropAndWait,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function editorCanvas(page: Page) {
  return editor(page).locator('.editor-canvas');
}

function overlayList(page: Page) {
  return editor(page).getByRole('list', { name: 'Superpositions' });
}

function thumbnail(page: Page) {
  return page.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE });
}

/** A Campaign with the 16x9 image imported and a Scene `sceneName` open in the editor. */
async function sceneWithImage(regie: RunningApp, sceneName: string) {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  await expect(thumbnail(controlWindow)).toBeVisible();
  await createScene(controlWindow, sceneName);
}

async function createScene(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill(name);
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Places the image as one more Overlay (at the canvas centre), drawn once loaded. */
async function placeOverlay(page: Page) {
  const count = await overlayList(page).getByRole('listitem').count();
  await dropAndWait(
    thumbnail(page),
    overlayList(page).locator('xpath=..'),
    overlayList(page).getByRole('listitem').nth(count),
  );
  await expect(overlayList(page).getByRole('listitem')).toHaveCount(count + 1);
  await expect(editorCanvas(page).locator('.canvas-overlay img:not([hidden])')).toHaveCount(
    count + 1,
  );
}

/** An Overlay's centre and height, as fractions of the canvas drawn in `canvas`. */
async function boxOn(canvas: Locator, overlay: Locator) {
  const stage = await canvas.locator('.scene-canvas-stage').boundingBox();
  const box = await overlay.boundingBox();
  if (!stage || !box) throw new Error('The canvas or the Overlay is not shown.');
  return {
    x: (box.x + box.width / 2 - stage.x) / stage.width,
    y: (box.y + box.height / 2 - stage.y) / stage.height,
    height: box.height / stage.height,
    aspect: box.width / box.height,
  };
}

/** Presses the mouse on `overlay`'s centre and moves it by fractions `dx`, `dy` of the canvas. */
async function pressAndMove(page: Page, overlay: Locator, dx: number, dy: number) {
  // Mouse positions are on screen: bring the canvas there first.
  await editorCanvas(page).scrollIntoViewIfNeeded();
  const stage = await editorCanvas(page).locator('.scene-canvas-stage').boundingBox();
  const box = await overlay.boundingBox();
  if (!stage || !box) throw new Error('The canvas or the Overlay is not shown.');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * stage.width, from.y + dy * stage.height, { steps: 8 });
}

/** The Scenes of the only Campaign, as saved. */
async function savedScenes(page: Page) {
  return page.evaluate(async () => {
    const regie = (
      window as unknown as {
        regie: {
          listCampaigns(): Promise<Campaign[]>;
          listScenes(id: string): Promise<Scene[]>;
        };
      }
    ).regie;
    const [campaign] = await regie.listCampaigns();
    return regie.listScenes(campaign.id);
  });
}

async function savedOverlays(page: Page, sceneName: string) {
  const scene = (await savedScenes(page)).find((item) => item.name === sceneName);
  return scene?.overlays ?? [];
}

test('an Overlay is dragged, resized with its proportions kept, and nudged with the arrow keys', async ({
  regie,
}) => {
  const { controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  await placeOverlay(page);
  const canvas = editorCanvas(page);
  const overlay = canvas.locator('.canvas-overlay');

  await pressAndMove(page, overlay, 0.2, 0.1);
  await page.mouse.up();
  let box = await boxOn(canvas, overlay);
  expect(box.x).toBeCloseTo(0.7, 2);
  expect(box.y).toBeCloseTo(0.6, 2);
  await expect
    .poll(async () => (await savedOverlays(page, 'Cantina'))[0]?.position.x)
    .toBeCloseTo(0.7, 2);

  // Resizing by the handle of the selected Overlay keeps the image's 16:9 proportions.
  await expect(overlay).toHaveClass(/is-selected/);
  await pressAndMove(page, overlay.locator('.canvas-overlay-handle'), -0.1, -0.1);
  await page.mouse.up();
  box = await boxOn(canvas, overlay);
  expect(box.height).toBeLessThan(0.45);
  expect(box.aspect).toBeCloseTo(16 / 9, 1);
  await expect
    .poll(async () => (await savedOverlays(page, 'Cantina'))[0]?.height)
    .toBeCloseTo(box.height, 2);

  // Three nudges left (10 canvas units each), then Shift for a bigger one up: one saved edit.
  const before = await boxOn(canvas, overlay);
  await canvas.press('ArrowLeft');
  await canvas.press('ArrowLeft');
  await canvas.press('ArrowLeft');
  await canvas.press('Shift+ArrowUp');
  box = await boxOn(canvas, overlay);
  expect(box.x).toBeCloseTo(before.x - 30 / 1920, 3);
  expect(box.y).toBeCloseTo(before.y - 50 / 1080, 3);
  await expect
    .poll(async () => (await savedOverlays(page, 'Cantina'))[0]?.position.x)
    .toBeCloseTo(box.x, 3);
});

test('Overlays are brought forward and sent back among themselves, always above every Background', async ({
  regie,
}) => {
  const { controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  await placeOverlay(page);
  await placeOverlay(page);
  const backgrounds = editor(page).getByRole('list', { name: 'Arrière-plans' });
  await dropAndWait(
    thumbnail(page),
    backgrounds.locator('xpath=..'),
    backgrounds.getByRole('listitem').first(),
  );
  const drawn = editorCanvas(page).locator('.canvas-background, .canvas-overlay');
  await expect(drawn).toHaveCount(3);
  const [first, second] = (await savedOverlays(page, 'Cantina')).map((item) => item.id);
  const order = () =>
    drawn.evaluateAll((items: Element[]) =>
      items.map((item) => item.getAttribute('data-overlay-id') ?? 'background'),
    );
  expect(await order()).toEqual(['background', first, second]);

  // The list reads front first, like the Background list: the first row cannot go further
  // forward, the last row cannot go further back.
  const reculer = overlayList(page).getByRole('button', { name: `Reculer ${IMAGE}` });
  const avancer = overlayList(page).getByRole('button', { name: `Avancer ${IMAGE}` });
  await expect(avancer.first()).toBeDisabled();
  await expect(reculer.last()).toBeDisabled();
  await reculer.first().click();
  await expect.poll(order).toEqual(['background', second, first]);
  // Sent back as far as it goes, the Overlay is still above the Background.
  await expect(reculer.last()).toBeDisabled();
  await avancer.last().click();
  await expect.poll(order).toEqual(['background', first, second]);
});

test('dragging an Overlay on the Active Scene moves it on the broadcast before release; the released position survives a restart', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  await sceneWithImage(regie, 'Cantina');
  await placeOverlay(page);
  await overlayList(page)
    .getByRole('checkbox', { name: `Afficher ${IMAGE}` })
    .check();
  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, page);
  const broadcastCanvas = broadcastWindow.locator('.scene-canvas');
  const onAir = broadcastWindow.locator('.canvas-overlay');
  await expect(onAir.locator('img:not([hidden])')).toHaveCount(1);
  expect((await boxOn(broadcastCanvas, onAir)).x).toBeCloseTo(0.5, 2);

  await pressAndMove(page, editorCanvas(page).locator('.canvas-overlay'), -0.25, 0.2);

  // Mouse still down: the players see the Overlay where it is, and nothing is saved yet.
  await expect.poll(async () => (await boxOn(broadcastCanvas, onAir)).x).toBeCloseTo(0.25, 2);
  expect((await boxOn(broadcastCanvas, onAir)).y).toBeCloseTo(0.7, 2);
  expect((await savedOverlays(page, 'Cantina'))[0].position).toEqual({ x: 0.5, y: 0.5 });

  await page.mouse.up();
  await expect
    .poll(async () => (await savedOverlays(page, 'Cantina'))[0]?.position.x)
    .toBeCloseTo(0.25, 2);
  expect((await boxOn(broadcastCanvas, onAir)).x).toBeCloseTo(0.25, 2);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const canvas = editorCanvas(restarted.controlWindow);
    const overlay = canvas.locator('.canvas-overlay');
    await expect(overlay.locator('img:not([hidden])')).toHaveCount(1);
    const box = await boxOn(canvas, overlay);
    expect(box.x).toBeCloseTo(0.25, 2);
    expect(box.y).toBeCloseTo(0.7, 2);
  } finally {
    await restarted.app.close();
  }
});

test('dragging an Overlay on a Scene that is not active never touches the broadcast', async ({
  regie,
}) => {
  const { app, controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  await placeOverlay(page);
  await overlayList(page)
    .getByRole('checkbox', { name: `Afficher ${IMAGE}` })
    .check();
  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, page);
  const screen = broadcastWindow.locator('main.broadcast-screen');
  await expect(broadcastWindow.locator('.canvas-overlay img:not([hidden])')).toHaveCount(1);
  const version = await screen.getAttribute('data-version');

  await createScene(page, 'Hangar');
  await placeOverlay(page);
  await overlayList(page)
    .getByRole('checkbox', { name: `Afficher ${IMAGE}` })
    .check();
  await expect(
    overlayList(page).getByRole('checkbox', { name: `Afficher ${IMAGE}` }),
  ).toBeChecked();
  const overlay = editorCanvas(page).locator('.canvas-overlay');
  await pressAndMove(page, overlay, 0.2, 0.2);
  await page.mouse.up();
  await expect
    .poll(async () => (await savedOverlays(page, 'Hangar'))[0]?.position.x)
    .toBeCloseTo(0.7, 2);

  // A round trip through the Broadcast bridge, then two frames: any change has arrived.
  await broadcastWindow.evaluate(async () => {
    await (window as unknown as { regie: { getOnAir(): Promise<unknown> } }).regie.getOnAir();
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
  });
  await expect(screen).toHaveAttribute('data-version', version ?? '');
  const broadcastCanvas = broadcastWindow.locator('.scene-canvas');
  expect((await boxOn(broadcastCanvas, broadcastWindow.locator('.canvas-overlay'))).x).toBeCloseTo(
    0.5,
    2,
  );
});

test('Ctrl+arrow on a selected Overlay nudges it and never Activates a Scene', async ({
  regie,
}) => {
  const { controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  await placeOverlay(page);
  const canvas = editorCanvas(page);
  const overlay = canvas.locator('.canvas-overlay');
  await pressAndMove(page, overlay, 0, 0);
  await page.mouse.up();
  await expect(overlay).toHaveClass(/is-selected/);

  const before = await boxOn(canvas, overlay);
  await canvas.press('Control+ArrowDown');
  await canvas.press('Control+ArrowUp');
  await canvas.press('Control+ArrowDown');

  const box = await boxOn(canvas, overlay);
  expect(box.y).toBeCloseTo(before.y + 10 / 1080, 3);
  const onAir = await page.evaluate(() =>
    (
      window as unknown as { regie: { getOnAir(): Promise<{ activeSceneId: string | null }> } }
    ).regie.getOnAir(),
  );
  expect(onAir.activeSceneId).toBeNull();
});
