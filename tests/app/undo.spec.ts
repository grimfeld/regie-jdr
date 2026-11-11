import type { Locator, Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  fixture,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function undoBar(page: Page) {
  return editor(page).getByRole('toolbar', { name: 'Historique de la scène' });
}

function undoButton(page: Page) {
  return undoBar(page).getByRole('button', { name: /annuler/i });
}

function redoButton(page: Page) {
  return undoBar(page).getByRole('button', { name: /rétablir/i });
}

function overlayList(page: Page) {
  return editor(page).getByRole('list', { name: 'Superpositions' });
}

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

/** Campaign "Star Wars" with the 16x9 image imported and Scene `sceneName` open in the editor. */
async function sceneWithImage({ app, controlWindow: page }: RunningApp, sceneName: string) {
  await createCampaign(page, 'Star Wars');
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    page.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
  await createScene(page, sceneName);
}

/** An Overlay's centre, as fractions of the canvas drawn in `canvas`. */
async function centreOn(canvas: Locator, overlay: Locator) {
  const stage = await canvas.locator('.scene-canvas-stage').boundingBox();
  const box = await overlay.boundingBox();
  if (!stage || !box) throw new Error('The canvas or the Overlay is not shown.');
  return {
    x: (box.x + box.width / 2 - stage.x) / stage.width,
    y: (box.y + box.height / 2 - stage.y) / stage.height,
  };
}

test('undo and redo on the Active Scene change the broadcast at once; a drag undoes as one step', async ({
  regie,
}) => {
  const { app, controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeDisabled();

  await editor(page).getByLabel('Image à placer').selectOption({ label: IMAGE });
  await editor(page).getByRole('button', { name: 'Ajouter en superposition' }).click();
  await expect(undoButton(page)).toHaveText(`Annuler : placer ${IMAGE} en superposition`);
  const show = overlayList(page).getByRole('checkbox', { name: `Afficher ${IMAGE}` });
  await show.check();
  await expect(undoButton(page)).toHaveText(`Annuler : afficher ${IMAGE}`);

  // Activating is not undoable: the next undo is still the show.
  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(app, page);
  const onAir = broadcastWindow.locator('.canvas-overlay img:not([hidden])');
  await expect(onAir).toHaveCount(1);
  await expect(undoButton(page)).toHaveText(`Annuler : afficher ${IMAGE}`);

  // Ctrl+Z hides it again for the players; Ctrl+Y shows it again.
  await page.locator('body').press('Control+z');
  await expect(onAir).toHaveCount(0);
  await expect(show).not.toBeChecked();
  await expect(redoButton(page)).toHaveText(`Rétablir : afficher ${IMAGE}`);
  await page.locator('body').press('Control+y');
  await expect(onAir).toHaveCount(1);
  await expect(show).toBeChecked();
  await expect(redoButton(page)).toBeDisabled();

  // A whole drag is one step, undone by the button: the players see the Overlay back.
  const canvas = editor(page).locator('.editor-canvas');
  const overlay = canvas.locator('.canvas-overlay');
  const stage = await canvas.locator('.scene-canvas-stage').boundingBox();
  const box = await overlay.boundingBox();
  if (!stage || !box) throw new Error('The canvas or the Overlay is not shown.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 0.25 * stage.width, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(undoButton(page)).toHaveText(`Annuler : déplacer ${IMAGE}`);
  const broadcastCanvas = broadcastWindow.locator('.scene-canvas');
  const broadcastOverlay = broadcastWindow.locator('.canvas-overlay');
  await expect
    .poll(async () => (await centreOn(broadcastCanvas, broadcastOverlay)).x)
    .toBeCloseTo(0.25, 2);

  await undoButton(page).click();
  await expect
    .poll(async () => (await centreOn(broadcastCanvas, broadcastOverlay)).x)
    .toBeCloseTo(0.5, 2);
  await expect(undoButton(page)).toHaveText(`Annuler : afficher ${IMAGE}`);
});

/** Presses the mouse on `target`'s centre, moves it by fractions of the canvas, releases it. */
async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
  const stage = await editor(page).locator('.scene-canvas-stage').boundingBox();
  const box = await target.boundingBox();
  if (!stage || !box) throw new Error('The canvas or the target is not shown.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + dx * stage.width,
    box.y + box.height / 2 + dy * stage.height,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
}

test('a burst of arrow-key nudges undoes as one step; a drag then a quick resize are two', async ({
  regie,
}) => {
  const { controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  await editor(page).getByLabel('Image à placer').selectOption({ label: IMAGE });
  await editor(page).getByRole('button', { name: 'Ajouter en superposition' }).click();
  const canvas = editor(page).locator('.editor-canvas');
  const overlay = canvas.locator('.canvas-overlay');
  await expect(canvas.locator('.canvas-overlay img:not([hidden])')).toHaveCount(1);

  await overlay.click();
  await expect(overlay).toHaveClass(/is-selected/);
  await canvas.press('ArrowLeft');
  await canvas.press('ArrowLeft');
  await canvas.press('ArrowLeft');
  await expect(undoButton(page)).toHaveText(`Annuler : déplacer ${IMAGE}`);
  await undoButton(page).click();
  await expect(undoButton(page)).toHaveText(`Annuler : placer ${IMAGE} en superposition`);
  await expect.poll(async () => (await centreOn(canvas, overlay)).x).toBeCloseTo(0.5, 3);

  // Two gestures, one right after the other: each is its own step.
  await dragBy(page, overlay, -0.2, 0);
  await dragBy(page, overlay.locator('.canvas-overlay-handle'), -0.05, -0.05);
  await expect(undoButton(page)).toHaveText(`Annuler : redimensionner ${IMAGE}`);
  await undoButton(page).click();
  await expect(undoButton(page)).toHaveText(`Annuler : déplacer ${IMAGE}`);
  await expect.poll(async () => (await centreOn(canvas, overlay)).x).toBeCloseTo(0.3, 2);
});

test('Ctrl+Z while typing in a field undoes the typing, not a Scene edit', async ({ regie }) => {
  const { controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  const title = editor(page).getByLabel('Titre affiché');
  await title.fill('Le vieux moulin');
  await title.press('Enter');
  await expect(undoButton(page)).toHaveText('Annuler : modifier le titre affiché');

  await title.focus();
  await title.press('End');
  await title.pressSequentially(' brûlé');
  await title.press('Control+z');

  // The Scene title saved is untouched and the undo button still offers the same step.
  await expect(undoButton(page)).toHaveText('Annuler : modifier le titre affiché');
  await expect(redoButton(page)).toBeDisabled();
});

test('each Scene keeps its own history when switching Scenes; switching Campaign clears it', async ({
  regie,
}) => {
  const { controlWindow: page } = regie;
  await sceneWithImage(regie, 'Cantina');
  await editor(page).getByRole('button', { name: 'Renommer' }).click();
  await editor(page).getByLabel('Nouveau nom de la scène').fill('Cantina de Mos Eisley');
  await editor(page).getByRole('button', { name: 'Enregistrer' }).click();
  await expect(undoButton(page)).toHaveText('Annuler : renommer la scène');

  await createScene(page, 'Hangar');
  await expect(undoButton(page)).toBeDisabled();

  await selectScene(page, 'Cantina de Mos Eisley');
  await expect(undoButton(page)).toHaveText('Annuler : renommer la scène');
  await undoButton(page).click();
  await expect(editor(page).getByRole('heading', { name: 'Cantina', exact: true })).toBeVisible();
  await expect(redoButton(page)).toHaveText('Rétablir : renommer la scène');

  await page.getByRole('button', { name: 'Campagnes' }).click();
  await page
    .getByRole('list', { name: 'Campagnes' })
    .getByRole('button', { name: 'Star Wars', exact: true })
    .click();
  await selectScene(page, 'Cantina');
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeDisabled();
});
