import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Locator, Page } from '@playwright/test';
import {
  createCampaign,
  dropFiles,
  expect,
  launchApp,
  openBroadcastWindow,
  picturePng,
  test,
  type Colour,
  type RunningApp,
} from './harness';

const BLUE: Colour = { red: 10, green: 40, blue: 200 };
const GREEN: Colour = { red: 20, green: 180, blue: 40 };

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function notesPanel(page: Page) {
  return page.getByRole('region', { name: 'Notes', exact: true });
}

function notes(page: Page) {
  return notesPanel(page).getByRole('textbox', { name: 'Notes de la scène' });
}

/** An image shown in the Notes, by its Media name. */
function notesImage(page: Page, name: string) {
  return notes(page).getByRole('img', { name, exact: true });
}

async function createScene(page: Page, name: string) {
  const scenes = page.getByRole('region', { name: 'Scènes' });
  await scenes.getByLabel('Nom de la scène').fill(name);
  await scenes.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

interface StoredNode {
  type: string;
  attrs?: { width?: number };
  content?: StoredNode[];
}

/** The widths of the images in the first Scene's stored Notes, in order; null: default size. */
async function storedImageWidths(dataDir: string): Promise<(number | null)[]> {
  const campaigns = path.join(dataDir, 'campaigns');
  const [campaignId] = await fs.readdir(campaigns);
  const file = path.join(campaigns, campaignId, 'scenes.json');
  const { scenes } = JSON.parse(await fs.readFile(file, 'utf8')) as {
    scenes: { notes: StoredNode }[];
  };
  const widths: (number | null)[] = [];
  const visit = (node: StoredNode) => {
    if (node.type === 'image') widths.push(node.attrs?.width ?? null);
    node.content?.forEach(visit);
  };
  if (scenes[0]) visit(scenes[0].notes);
  return widths;
}

/** An image's width in the Notes, in % of the width it stands in, rounded. */
function shownPercent(image: Locator): Promise<number> {
  return image.evaluate((img) => {
    const holder = img.closest('.notes-image');
    if (!holder) throw new Error('not a Notes image');
    return Math.round(
      (img.getBoundingClientRect().width / holder.getBoundingClientRect().width) * 100,
    );
  });
}

/**
 * Drags `handle` sideways by `dx` pixels with the mouse, and waits for its visible end state:
 * the image shown at `expected` % (docs/wiki/problem-flaky-app-tests.md).
 */
async function dragHandle(
  page: Page,
  handle: Locator,
  dx: number,
  image: Locator,
  expected: number,
) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('resize handle not shown');
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => shownPercent(image)).toBe(expected);
}

async function setControlWidth(app: RunningApp['app'], page: Page, width: number) {
  const browserWindow = await app.browserWindow(page);
  const height = await page.evaluate(() => window.innerHeight);
  await browserWindow.evaluate(
    (w: BrowserWindow, size) => w.setContentSize(size.width, size.height),
    {
      width,
      height,
    },
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
}

test('a Notes image is resized by its corner handle, as a share of the panel, undoable and kept after a restart', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Embuscade');
  const map = await picturePng(regie, 'Plan du fort.png', { width: 1600, height: 800 }, GREEN);
  const badge = await picturePng(regie, 'Insigne.png', { width: 60, height: 30 }, BLUE);
  expect(await dropFiles(notes(page), [map, badge])).toBe(true);
  const mapImage = notesImage(page, 'Plan du fort');
  const badgeImage = notesImage(page, 'Insigne');
  await expect(badgeImage).toBeVisible();

  // Default size: the panel's width for a large image, its own width for a small one.
  await expect.poll(() => shownPercent(mapImage)).toBe(100);
  await expect.poll(() => badgeImage.evaluate((img) => img.getBoundingClientRect().width)).toBe(60);
  await expect.poll(() => storedImageWidths(regie.dataDir)).toEqual([null, null]);

  // A click selects the image and shows its handle.
  const handle = notesPanel(page).getByRole('button', { name: 'Redimensionner Plan du fort' });
  await expect(handle).toHaveCount(0);
  await mapImage.click();
  await expect(handle).toBeVisible();

  const panelWidth = await mapImage.evaluate(
    (img) => img.closest('.notes-image')?.getBoundingClientRect().width ?? 0,
  );
  await dragHandle(page, handle, -panelWidth / 2, mapImage, 50);
  await expect.poll(() => storedImageWidths(regie.dataDir)).toEqual([50, null]);
  // Aspect locked: half as high as wide, as the picture.
  const box = await mapImage.boundingBox();
  expect(Math.abs((box?.width ?? 0) / 2 - (box?.height ?? 0))).toBeLessThanOrEqual(1);

  // Never narrower than 10 % of the panel.
  await dragHandle(page, handle, -2000, mapImage, 10);
  await expect.poll(() => storedImageWidths(regie.dataDir)).toEqual([10, null]);

  // Each resize is one step of the Notes undo.
  const undo = notesPanel(page).getByRole('button', { name: 'Annuler dans les notes' });
  await undo.click();
  await expect.poll(() => shownPercent(mapImage)).toBe(50);
  await undo.click();
  await expect.poll(() => shownPercent(mapImage)).toBe(100);
  await expect.poll(() => storedImageWidths(regie.dataDir)).toEqual([null, null]);
  await notesPanel(page).getByRole('button', { name: 'Rétablir dans les notes' }).click();
  await expect.poll(() => shownPercent(mapImage)).toBe(50);
  await expect.poll(() => storedImageWidths(regie.dataDir)).toEqual([50, null]);

  // The size follows the panel when the window is resized.
  const panelBefore = await notesPanel(page).evaluate((panel) => panel.clientWidth);
  await setControlWidth(regie.app, page, 1400);
  await expect
    .poll(() => notesPanel(page).evaluate((panel) => panel.clientWidth))
    .not.toBe(panelBefore);
  await expect.poll(() => shownPercent(mapImage)).toBe(50);

  await regie.app.close();
  const restarted = await launchApp(regie.dataDir);
  try {
    await expect
      .poll(() => shownPercent(notesImage(restarted.controlWindow, 'Plan du fort')))
      .toBe(50);
    await expect(notesImage(restarted.controlWindow, 'Insigne')).toBeVisible();
    expect(await storedImageWidths(regie.dataDir)).toEqual([50, null]);
  } finally {
    await restarted.app.close();
  }
});

test('a double-clicked Notes image is shown enlarged in the Control window only', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Embuscade');
  const map = await picturePng(regie, 'Plan du fort.png', { width: 1600, height: 800 }, GREEN);
  expect(await dropFiles(notes(page), [map])).toBe(true);
  await expect(notesImage(page, 'Plan du fort')).toBeVisible();
  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(regie.app, page);

  await notesImage(page, 'Plan du fort').dblclick();

  const enlarged = page.getByRole('dialog', { name: 'Agrandissement de Plan du fort' });
  await expect(enlarged).toBeVisible();
  const enlargedImage = enlarged.getByRole('img', { name: 'Plan du fort' });
  await expect(enlargedImage).toHaveAttribute('src', /^regie-media:\/\/media\//);
  const inNotes = (await notesImage(page, 'Plan du fort').boundingBox())?.width ?? 0;
  await expect
    .poll(async () => (await enlargedImage.boundingBox())?.width ?? 0)
    .toBeGreaterThan(inNotes);
  await expect(broadcastWindow.locator('img')).toHaveCount(0);
  await expect(broadcastWindow.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(enlarged).toHaveCount(0);

  // Closed with its button too; the Notes are unchanged.
  await notesImage(page, 'Plan du fort').dblclick();
  await enlarged.getByRole('button', { name: 'Fermer' }).click();
  await expect(enlarged).toHaveCount(0);
  await expect(notesImage(page, 'Plan du fort')).toHaveCount(1);
  expect(await storedImageWidths(regie.dataDir)).toEqual([null]);
});
