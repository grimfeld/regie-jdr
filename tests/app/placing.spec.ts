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

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function thumbnail(page: Page) {
  return page.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE });
}

function editorCanvas(page: Page) {
  return editor(page).locator('.editor-canvas');
}

function backgroundList(page: Page) {
  return editor(page).getByRole('list', { name: 'Arrière-plans' });
}

function overlayList(page: Page) {
  return editor(page).getByRole('list', { name: 'Superpositions' });
}

/** The drop area around a placement list (the list itself is empty, so has no height). */
function dropZone(list: ReturnType<typeof backgroundList>) {
  return list.locator('xpath=..');
}

async function importImage({ app, controlWindow }: RunningApp) {
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  await expect(thumbnail(controlWindow)).toBeVisible();
}

async function setCategory(page: Page, category: 'Décors' | 'Personnage') {
  await page.getByLabel(`Catégorie de ${IMAGE}`).selectOption({ label: category });
  await expect(page.getByLabel(`Catégorie de ${IMAGE}`)).toHaveValue(
    category === 'Décors' ? 'scenery' : 'character',
  );
}

async function createScene(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill(name);
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Drags the library thumbnail onto the editor canvas, at fractions `x`, `y` of the canvas. */
async function dropOnCanvas(page: Page, x: number, y: number) {
  const box = await editorCanvas(page).locator('.scene-canvas').boundingBox();
  if (!box) throw new Error('The editor canvas is not shown.');
  await thumbnail(page).dragTo(editorCanvas(page).locator('.scene-canvas'), {
    targetPosition: { x: box.width * x, y: box.height * y },
  });
}

/** Centre of the editor's only Overlay, as fractions of the canvas. */
async function overlayCentre(page: Page) {
  const canvas = await editorCanvas(page).locator('.scene-canvas').boundingBox();
  const overlay = await editorCanvas(page).locator('.canvas-overlay').boundingBox();
  if (!canvas || !overlay) throw new Error('The canvas or the Overlay is not shown.');
  return {
    x: (overlay.x + overlay.width / 2 - canvas.x) / canvas.width,
    y: (overlay.y + overlay.height / 2 - canvas.y) / canvas.height,
  };
}

/** The visible-checkbox of the `index`th placement in a list. */
function toggle(list: ReturnType<typeof backgroundList>, index = 0) {
  return list.getByRole('checkbox', { name: `Afficher ${IMAGE}` }).nth(index);
}

function broadcastScreen(broadcastWindow: Page) {
  return broadcastWindow.locator('main.broadcast-screen');
}

test('dropping on the canvas places Scenery as a Background and a Character as an Overlay at the drop point, Hidden', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');

  await setCategory(controlWindow, 'Décors');
  await dropOnCanvas(controlWindow, 0.5, 0.5);
  await expect(toggle(backgroundList(controlWindow))).not.toBeChecked();
  await expect(backgroundList(controlWindow)).toContainText('Masqué');
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(0);
  const background = editorCanvas(controlWindow).locator('.canvas-background');
  await expect(background).toHaveCount(1);
  await expect(background).toHaveClass(/is-hidden/);

  await setCategory(controlWindow, 'Personnage');
  await dropOnCanvas(controlWindow, 0.25, 0.75);
  await expect(toggle(overlayList(controlWindow))).not.toBeChecked();
  await expect(backgroundList(controlWindow).getByRole('listitem')).toHaveCount(1);
  const overlay = editorCanvas(controlWindow).locator('.canvas-overlay');
  await expect(overlay).toHaveClass(/is-hidden/);
  await expect(overlay.locator('img:not([hidden])')).toHaveCount(1);

  // Centred where it was dropped, half the canvas high, with the image's proportions.
  const canvas = await editorCanvas(controlWindow).locator('.scene-canvas').boundingBox();
  const placed = await overlay.boundingBox();
  if (!canvas || !placed) throw new Error('The canvas or the Overlay is not shown.');
  expect(placed.x + placed.width / 2 - canvas.x).toBeCloseTo(canvas.width * 0.25, -1);
  expect(placed.y + placed.height / 2 - canvas.y).toBeCloseTo(canvas.height * 0.75, -1);
  expect(placed.height).toBeCloseTo(canvas.height / 2, -1);
  expect(placed.width).toBeCloseTo((placed.height * 16) / 9, -1);
});

test('dropping on a list places the image as that list’s type, whatever its category, as often as wanted', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await setCategory(controlWindow, 'Décors');

  await thumbnail(controlWindow).dragTo(dropZone(overlayList(controlWindow)));
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(1);
  await thumbnail(controlWindow).dragTo(dropZone(overlayList(controlWindow)));
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(2);
  await expect(backgroundList(controlWindow).getByRole('listitem')).toHaveCount(0);

  await setCategory(controlWindow, 'Personnage');
  await thumbnail(controlWindow).dragTo(dropZone(backgroundList(controlWindow)));
  await expect(backgroundList(controlWindow).getByRole('listitem')).toHaveCount(1);
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(2);

  // Overlays are drawn above every Background, the one placed last included.
  const drawn = editorCanvas(controlWindow).locator('.canvas-background, .canvas-overlay');
  await expect(drawn).toHaveCount(3);
  const isOverlay = await drawn.evaluateAll((items: Element[]) =>
    items.map((item) => item.classList.contains('canvas-overlay')),
  );
  expect(isOverlay).toEqual([false, true, true]);
});

test('on the Active Scene, placements stay off the broadcast until shown; show, hide and remove go on air', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');

  // Each drop's row pushes the library (the drag source) down: wait for it before the next drag.
  await thumbnail(controlWindow).dragTo(dropZone(backgroundList(controlWindow)));
  await expect(backgroundList(controlWindow).getByRole('listitem')).toHaveCount(1);
  await thumbnail(controlWindow).dragTo(dropZone(overlayList(controlWindow)));
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(1);
  await expect(broadcastWindow.locator('.canvas-background, .canvas-overlay')).toHaveCount(0);

  await toggle(overlayList(controlWindow)).check();
  await expect(broadcastWindow.locator('.canvas-overlay img:not([hidden])')).toHaveCount(1);
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  await toggle(backgroundList(controlWindow)).check();
  await expect(broadcastWindow.locator('.canvas-background img:not([hidden])')).toHaveCount(1);

  await toggle(overlayList(controlWindow)).uncheck();
  await expect(broadcastWindow.locator('.canvas-overlay')).toHaveCount(0);
  await backgroundList(controlWindow)
    .getByRole('button', { name: `Retirer ${IMAGE}` })
    .click();
  await expect(backgroundList(controlWindow).getByRole('listitem')).toHaveCount(0);
  await expect(broadcastWindow.locator('.canvas-background')).toHaveCount(0);
  await expect(editorCanvas(controlWindow).locator('.canvas-background')).toHaveCount(0);
});

test('placing, showing and removing on a Scene that is not active leaves the broadcast as it is', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(controlWindow)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  await expect(broadcastScreen(broadcastWindow)).not.toHaveAttribute('data-active-scene-id', '');
  const version = await broadcastScreen(broadcastWindow).getAttribute('data-version');

  await createScene(controlWindow, 'Hangar');
  // Each drop's row pushes the library (the drag source) down: wait for it before the next drag.
  await thumbnail(controlWindow).dragTo(dropZone(overlayList(controlWindow)));
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(1);
  await thumbnail(controlWindow).dragTo(dropZone(overlayList(controlWindow)));
  // The list reads front first: wait for the second Overlay's row before picking rows.
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(2);
  await toggle(overlayList(controlWindow), 0).check();
  await expect(toggle(overlayList(controlWindow), 0)).toBeChecked();
  await overlayList(controlWindow)
    .getByRole('button', { name: `Retirer ${IMAGE}` })
    .nth(1)
    .click();
  await expect(overlayList(controlWindow).getByRole('listitem')).toHaveCount(1);

  // A round trip through the Broadcast bridge, then two frames: any change has arrived.
  await broadcastWindow.evaluate(async () => {
    await (window as unknown as { regie: { getOnAir(): Promise<unknown> } }).regie.getOnAir();
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
  });
  await expect(broadcastScreen(broadcastWindow)).toHaveAttribute('data-version', version ?? '');
  await expect(broadcastWindow.locator('.canvas-overlay')).toHaveCount(0);
});

test('placements, their visibility and drop position survive a restart', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  await importImage(regie);
  await createScene(controlWindow, 'Cantina');
  await thumbnail(controlWindow).dragTo(dropZone(backgroundList(controlWindow)));
  // The new row pushes the library (the drag source) down: wait for it before the next drag.
  await expect(backgroundList(controlWindow).getByRole('listitem')).toHaveCount(1);
  await setCategory(controlWindow, 'Personnage');
  await dropOnCanvas(controlWindow, 0.25, 0.75);
  await toggle(overlayList(controlWindow)).check();
  await expect(toggle(overlayList(controlWindow))).toBeChecked();
  const before = await overlayCentre(controlWindow);
  await app.close();

  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    await expect(editor(page).getByRole('heading', { name: 'Cantina', exact: true })).toBeVisible();
    await expect(toggle(backgroundList(page))).not.toBeChecked();
    await expect(toggle(overlayList(page))).toBeChecked();
    const overlay = editorCanvas(page).locator('.canvas-overlay');
    await expect(overlay.locator('img:not([hidden])')).toHaveCount(1);
    const after = await overlayCentre(page);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
  } finally {
    await restarted.app.close();
  }
});
