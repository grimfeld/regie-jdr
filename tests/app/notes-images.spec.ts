import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  dragOnScreen,
  dropFiles,
  expect,
  launchApp,
  openBroadcastWindow,
  picturePng,
  stubFilePicker,
  test,
  type Colour,
  type RunningApp,
} from './harness';

const BLUE: Colour = { red: 10, green: 40, blue: 200 };
const GREEN: Colour = { red: 20, green: 180, blue: 40 };

function scenesPanel(page: Page) {
  return page.getByRole('region', { name: 'Scènes' });
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function notes(page: Page) {
  return page
    .getByRole('region', { name: 'Notes', exact: true })
    .getByRole('textbox', { name: 'Notes de la scène' });
}

/** The images shown in the Notes, by their Media name. */
function notesImage(page: Page, name: string) {
  return notes(page).getByRole('img', { name, exact: true });
}

function library(page: Page) {
  return page.getByRole('list', { name: 'Images' });
}

function libraryItem(page: Page, name: string) {
  return library(page).getByRole('listitem').filter({ hasText: name });
}

function libraryFilter(page: Page, label: string) {
  return page
    .getByRole('group', { name: 'Filtrer les images' })
    .getByRole('button', { name: label, exact: true });
}

async function createScene(page: Page, name: string) {
  await scenesPanel(page).getByLabel('Nom de la scène').fill(name);
  await scenesPanel(page).getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

async function campaignFolder(dataDir: string): Promise<string> {
  const campaigns = path.join(dataDir, 'campaigns');
  const [campaignId] = await fs.readdir(campaigns);
  return path.join(campaigns, campaignId);
}

interface StoredMedia {
  id: string;
  name: string;
  category?: string;
  contentHash: string;
}

/** The only Campaign's Media index, as stored. */
async function storedMedia(dataDir: string): Promise<StoredMedia[]> {
  const file = path.join(await campaignFolder(dataDir), 'media.json');
  return (JSON.parse(await fs.readFile(file, 'utf8')) as { media: StoredMedia[] }).media;
}

/** The stored Notes of the first Scene, as JSON text. */
async function storedNotes(dataDir: string): Promise<string> {
  const file = path.join(await campaignFolder(dataDir), 'scenes.json');
  const { scenes } = JSON.parse(await fs.readFile(file, 'utf8')) as {
    scenes: { notes: unknown }[];
  };
  return JSON.stringify(scenes[0]?.notes);
}

/** The Media ids of the images in the stored Notes, in order. */
async function storedNotesImages(dataDir: string): Promise<string[]> {
  const stored = await storedNotes(dataDir);
  return [...stored.matchAll(/"type":"image","attrs":\{"mediaId":"([^"]+)"\}/g)].map(
    ([, id]) => id,
  );
}

/**
 * Pastes the image file `file` into the Notes, as a screenshot is pasted: a clipboard holding an
 * image file named `image.png` (as Chromium names one) and no text.
 */
async function pasteImage(page: Page, file: string) {
  const base64 = (await fs.readFile(file)).toString('base64');
  await notes(page).click();
  await notes(page).evaluate((target, content) => {
    const bytes = Uint8Array.from(atob(content), (letter) => letter.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, base64);
}

async function restart(running: RunningApp): Promise<RunningApp> {
  await running.app.close();
  return launchApp(running.dataDir);
}

test('a pasted screenshot is imported once as Reference and shown in the Notes', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  const screenshot = await picturePng(regie, 'capture.png', { width: 64, height: 36 }, BLUE);

  await pasteImage(page, screenshot);

  await expect(notesImage(page, 'Image collée')).toHaveAttribute('src', /^regie-media:\/\/media\//);
  await expect
    .poll(() => storedMedia(regie.dataDir))
    .toEqual([expect.objectContaining({ name: 'Image collée', category: 'reference' })]);
  await expect(libraryItem(page, 'Image collée')).toBeVisible();

  // The same screenshot again: a second image in the Notes, still one Media.
  await page.keyboard.press('End');
  await pasteImage(page, screenshot);
  await expect(notesImage(page, 'Image collée')).toHaveCount(2);
  await expect.poll(() => storedNotesImages(regie.dataDir)).toHaveLength(2);
  const [media] = await storedMedia(regie.dataDir);
  expect(await storedNotesImages(regie.dataDir)).toEqual([media.id, media.id]);
  expect(await storedMedia(regie.dataDir)).toHaveLength(1);
});

test('pasted content that is not an image is refused with a notice', async ({ regie }) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  const fake = path.join(regie.dataDir, 'faux.png');
  await fs.writeFile(fake, 'ceci n’est pas une image');

  await pasteImage(page, fake);

  await expect(page.getByText('ce n’est pas une image PNG, JPEG ou WebP')).toBeVisible();
  await expect(notes(page).getByRole('img')).toHaveCount(0);
  await expect(library(page).getByRole('listitem')).toHaveCount(0);
});

test('image files dropped from Explorer go into the Notes as Reference, one copy per content', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  const map = await picturePng(regie, 'Carte secrète.png', { width: 80, height: 45 }, GREEN);
  const scenery = await picturePng(regie, 'Port.png', { width: 80, height: 45 }, BLUE);
  // Already in the library as Scenery: dropping it into the Notes keeps it so.
  await stubFilePicker(regie.app, [scenery]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  await expect(libraryItem(page, 'Port')).toBeVisible();

  expect(await dropFiles(notes(page), [map, scenery])).toBe(true);

  await expect(notesImage(page, 'Carte secrète')).toBeVisible();
  await expect(notesImage(page, 'Port')).toBeVisible();
  await expect(libraryItem(page, 'Carte secrète')).toBeVisible();
  await expect.poll(() => storedNotesImages(regie.dataDir)).toHaveLength(2);
  expect(
    (await storedMedia(regie.dataDir)).map(({ name, category }) => ({ name, category })),
  ).toEqual([
    { name: 'Port', category: 'scenery' },
    { name: 'Carte secrète', category: 'reference' },
  ]);

  // The same file dropped again: no second Media.
  expect(await dropFiles(notes(page), [map])).toBe(true);
  await expect(notesImage(page, 'Carte secrète')).toHaveCount(2);
  expect(await storedMedia(regie.dataDir)).toHaveLength(2);
});

test('a library image dragged into the Notes is inserted as it is', async ({ regie }) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  const portrait = await picturePng(regie, 'Vador.png', { width: 40, height: 60 }, BLUE);
  await stubFilePicker(regie.app, [portrait]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  await page.getByLabel('Catégorie de Vador').selectOption({ label: 'Personnage' });

  await dragOnScreen(libraryItem(page, 'Vador').getByRole('img', { name: 'Vador' }), notes(page));

  await expect(notesImage(page, 'Vador')).toBeVisible();
  const [media] = await storedMedia(regie.dataDir);
  await expect.poll(() => storedNotesImages(regie.dataDir)).toEqual([media.id]);
  expect(media.category).toBe('character');
});

test('Notes images are stored as Media ids, survive a restart and never reach the Broadcast window', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Embuscade');
  const map = await picturePng(regie, 'Plan du fort.png', { width: 80, height: 45 }, GREEN);
  expect(await dropFiles(notes(page), [map])).toBe(true);
  await expect(notesImage(page, 'Plan du fort')).toBeVisible();
  const [media] = await storedMedia(regie.dataDir);
  await expect.poll(() => storedNotesImages(regie.dataDir)).toEqual([media.id]);

  const stored = await storedNotes(regie.dataDir);
  for (const leak of ['regie-media', 'Plan du fort', 'picked', 'base64', media.contentHash]) {
    expect(stored).not.toContain(leak);
  }

  await editor(page).getByRole('button', { name: 'Activer' }).click();
  await expect(editor(page)).toContainText('EN DIRECT');
  const broadcastWindow = await openBroadcastWindow(regie.app, page);
  await expect(broadcastWindow.locator('img')).toHaveCount(0);
  expect(await broadcastWindow.content()).not.toContain(media.contentHash);

  const restarted = await restart(regie);
  try {
    await expect(notesImage(restarted.controlWindow, 'Plan du fort')).toHaveAttribute(
      'src',
      new RegExp(media.contentHash),
    );
  } finally {
    await restarted.app.close();
  }
});

test('the library filters Reference images, and a Reference image can change category and be placed', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Cantina');
  const scenery = await picturePng(regie, 'Port.png', { width: 80, height: 45 }, BLUE);
  await stubFilePicker(regie.app, [scenery]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  const map = await picturePng(regie, 'Carte.png', { width: 80, height: 45 }, GREEN);
  expect(await dropFiles(notes(page), [map])).toBe(true);
  await expect(libraryItem(page, 'Carte')).toBeVisible();

  await libraryFilter(page, 'Références').click();
  await expect(library(page).getByRole('listitem')).toHaveCount(1);
  await expect(libraryItem(page, 'Carte')).toBeVisible();
  await expect(page.getByLabel('Catégorie de Carte')).toHaveValue('reference');

  // Placed on the Scene like any other image.
  await dragOnScreen(
    libraryItem(page, 'Carte').getByRole('img', { name: 'Carte' }),
    // The drop area around the Overlay list (empty, so it has no height).
    editor(page).getByRole('list', { name: 'Superpositions' }).locator('xpath=..'),
  );
  await expect(
    editor(page).getByRole('list', { name: 'Superpositions' }).getByText('Carte'),
  ).toBeVisible();

  await page.getByLabel('Catégorie de Carte').selectOption({ label: 'Décors' });
  await expect(library(page).getByRole('listitem')).toHaveCount(0);
  await libraryFilter(page, 'Décors').click();
  await expect(library(page).getByRole('listitem')).toHaveCount(2);
  await expect
    .poll(async () => (await storedMedia(regie.dataDir)).map((m) => m.category))
    .toEqual(['scenery', 'scenery']);
});

test('deleting an image used in Notes lists their Scene; confirming removes it from the Notes', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Embuscade');
  await notes(page).click();
  await page.keyboard.type('Le plan :');
  const map = await picturePng(regie, 'Plan du fort.png', { width: 80, height: 45 }, GREEN);
  expect(await dropFiles(notes(page), [map])).toBe(true);
  await expect(notesImage(page, 'Plan du fort')).toBeVisible();
  await expect.poll(() => storedNotesImages(regie.dataDir)).toHaveLength(1);

  await libraryFilter(page, 'Références').click();
  await libraryItem(page, 'Plan du fort')
    .getByRole('button', { name: 'Supprimer Plan du fort' })
    .click();
  const dialog = page.getByRole('alertdialog', { name: 'Supprimer le média' });
  await expect(dialog).toContainText('« Plan du fort » est utilisé dans les notes de cette scène.');
  await expect(dialog.getByRole('list', { name: 'Notes concernées' })).toHaveText('Embuscade');
  await dialog.getByRole('button', { name: 'Supprimer quand même' }).click();

  await expect(library(page).getByRole('listitem')).toHaveCount(0);
  await expect(notes(page).getByRole('img')).toHaveCount(0);
  await expect(notes(page)).toContainText('Le plan :');
  expect(await storedNotesImages(regie.dataDir)).toEqual([]);
  expect(await storedNotes(regie.dataDir)).toContain('Le plan :');
  // The Notes undo starts again: it cannot bring the deleted image back.
  await expect(page.getByRole('button', { name: 'Annuler dans les notes' })).toBeDisabled();
});

test('a Notes image whose file is missing on disk shows the missing-Media placeholder', async ({
  regie,
}) => {
  const page = regie.controlWindow;
  await createCampaign(page, 'Star Wars');
  await createScene(page, 'Embuscade');
  const map = await picturePng(regie, 'Plan du fort.png', { width: 80, height: 45 }, GREEN);
  expect(await dropFiles(notes(page), [map])).toBe(true);
  await expect(notesImage(page, 'Plan du fort')).toBeVisible();
  await expect.poll(() => storedNotesImages(regie.dataDir)).toHaveLength(1);
  await regie.app.close();

  // The file goes outside the app; the Media stays in the library.
  const folder = path.join(await campaignFolder(regie.dataDir), 'media');
  for (const file of await fs.readdir(folder)) await fs.rm(path.join(folder, file));
  const restarted = await launchApp(regie.dataDir);
  try {
    await expect(
      notes(restarted.controlWindow).getByRole('img', { name: 'Média manquant : Plan du fort' }),
    ).toBeVisible();
  } finally {
    await restarted.app.close();
  }
});
