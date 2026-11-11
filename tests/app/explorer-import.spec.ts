import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { createCampaign, dropFiles, expect, fixture, openBroadcastWindow, test } from './harness';

const IMAGE = 'red-16x9';

/** A file outside the app, as found in a folder of the Game Master's. */
async function fileOnDisk(dataDir: string, name: string, content: string): Promise<string> {
  const folder = path.join(dataDir, 'explorateur');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await fs.writeFile(file, content);
  return file;
}

/** Files in the media folders of every Campaign. */
async function storedMediaFiles(dataDir: string): Promise<string[]> {
  const campaigns = await fs.readdir(path.join(dataDir, 'campaigns'));
  const files = await Promise.all(
    campaigns.map((id) =>
      fs.readdir(path.join(dataDir, 'campaigns', id, 'media')).catch(() => [] as string[]),
    ),
  );
  return files.flat();
}

function library(page: Page) {
  return page.getByRole('region', { name: 'Bibliothèque' });
}

function images(page: Page) {
  return page.getByRole('list', { name: 'Images' });
}

function sounds(page: Page) {
  return page.getByRole('list', { name: 'Sons' });
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

async function createScene(page: Page, name: string) {
  const panel = page.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill(name);
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

test('files dropped on the library are imported, sounds with the role asked for; other types are refused with a message', async ({
  regie,
}) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  const notes = await fileOnDisk(dataDir, 'notes.txt', 'pas une image');
  const sound = await fileOnDisk(dataDir, 'cloche.ogg', 'OggS');

  const over = await dropFiles(library(controlWindow), [fixture(`${IMAGE}.png`), notes, sound]);

  expect(over).toBe(true);
  await expect(images(controlWindow).getByRole('img', { name: IMAGE })).toBeVisible();
  await expect(images(controlWindow).getByRole('listitem')).toHaveCount(1);
  await expect(controlWindow.getByRole('alert')).toContainText([
    '« notes.txt » n’a pas été importé : ce type de fichier n’est pas pris en charge',
  ]);
  // The sound waits for its role, which cannot be changed later.
  const question = controlWindow.getByRole('dialog', { name: 'Rôle des sons' });
  await expect(question).toContainText(
    'Quel rôle donner à ce son ? Il ne pourra plus être changé.',
  );
  await question.getByRole('button', { name: 'Bruitage' }).click();
  await expect(question).toHaveCount(0);
  await expect(sounds(controlWindow).getByRole('listitem')).toHaveCount(1);
  await expect(sounds(controlWindow).getByRole('listitem')).toContainText('cloche');
  await expect(sounds(controlWindow).getByRole('listitem')).toContainText('Bruitage');
  expect(await storedMediaFiles(dataDir)).toHaveLength(2);
});

test('cancelling the role of dropped sounds imports none of them', async ({ regie }) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  const sound = await fileOnDisk(dataDir, 'cloche.ogg', 'OggS');
  const other = await fileOnDisk(dataDir, 'gong.mp3', 'gong');

  await dropFiles(library(controlWindow), [sound, other]);
  const question = controlWindow.getByRole('dialog', { name: 'Rôle des sons' });
  await expect(question).toContainText('Quel rôle donner à ces 2 sons ?');
  await question.getByRole('button', { name: 'Annuler' }).click();

  await expect(question).toHaveCount(0);
  await expect(sounds(controlWindow).getByRole('listitem')).toHaveCount(0);
  expect(await storedMediaFiles(dataDir)).toEqual([]);
});

test('a sound dropped on the Scene editor is refused: only images are placed there', async ({
  regie,
}) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  await createScene(controlWindow, 'Cantina');
  const sound = await fileOnDisk(dataDir, 'cloche.ogg', 'OggS');

  await dropFiles(editor(controlWindow).locator('.editor-canvas .scene-canvas'), [sound]);

  await expect(controlWindow.getByRole('alert')).toContainText(
    '« cloche.ogg » n’a pas été importé : ce n’est pas une image.',
  );
  expect(await storedMediaFiles(dataDir)).toEqual([]);
});

test('dropping a file the Campaign already has keeps one Media and one file', async ({ regie }) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  const copy = path.join(dataDir, 'explorateur', 'copie.png');
  await fs.mkdir(path.dirname(copy), { recursive: true });
  await fs.copyFile(fixture(`${IMAGE}.png`), copy);

  await dropFiles(library(controlWindow), [fixture(`${IMAGE}.png`)]);
  await expect(images(controlWindow).getByRole('listitem')).toHaveCount(1);
  await dropFiles(library(controlWindow), [fixture(`${IMAGE}.png`)]);
  await dropFiles(library(controlWindow), [copy]);

  // Imports into a Campaign run one after another: once a new file shows, the others are done.
  await dropFiles(library(controlWindow), [await fileOnDisk(dataDir, 'autre.png', 'autre')]);
  await expect(images(controlWindow).getByRole('listitem')).toHaveCount(2);
  await expect(images(controlWindow).getByRole('img', { name: IMAGE })).toHaveCount(1);
  expect(await storedMediaFiles(dataDir)).toHaveLength(2);
});

test('files dropped on the canvas or a list are imported and placed, Hidden', async ({ regie }) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  await createScene(controlWindow, 'Cantina');
  const canvas = editor(controlWindow).locator('.editor-canvas');
  const backgrounds = editor(controlWindow).getByRole('list', { name: 'Arrière-plans' });
  const overlays = editor(controlWindow).getByRole('list', { name: 'Superpositions' });

  // A new image is Scenery: on the canvas, it becomes a Background.
  const over = await dropFiles(canvas.locator('.scene-canvas'), [fixture(`${IMAGE}.png`)]);
  expect(over).toBe(true);
  await expect(backgrounds.getByRole('listitem')).toHaveCount(1);
  await expect(backgrounds.getByRole('checkbox', { name: `Afficher ${IMAGE}` })).not.toBeChecked();
  await expect(canvas.locator('.canvas-background')).toHaveClass(/is-hidden/);
  // The library shows the imported image too.
  await expect(images(controlWindow).getByRole('img', { name: IMAGE })).toBeVisible();

  // On the Overlay list: an Overlay, whatever its category; the same Media, not a second one.
  await dropFiles(overlays.locator('xpath=..'), [fixture(`${IMAGE}.png`)]);
  await expect(overlays.getByRole('listitem')).toHaveCount(1);
  await expect(overlays.getByRole('checkbox', { name: `Afficher ${IMAGE}` })).not.toBeChecked();
  await expect(canvas.locator('.canvas-overlay')).toHaveClass(/is-hidden/);

  // A refused file is reported and placed nowhere.
  const notes = await fileOnDisk(dataDir, 'notes.txt', 'pas une image');
  await dropFiles(backgrounds.locator('xpath=..'), [notes]);
  await expect(controlWindow.getByRole('alert')).toContainText('« notes.txt » n’a pas été importé');
  await expect(backgrounds.getByRole('listitem')).toHaveCount(1);
  await expect(images(controlWindow).getByRole('listitem')).toHaveCount(1);
  expect(await storedMediaFiles(dataDir)).toHaveLength(1);
});

test('the Broadcast window takes no dropped files', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  await createScene(controlWindow, 'Cantina');
  await controlWindow.getByRole('button', { name: 'Activer' }).click();
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  const page = broadcastWindow.url();

  const over = await dropFiles(broadcastWindow.locator('main.broadcast-screen'), [
    fixture(`${IMAGE}.png`),
  ]);

  // The page refuses the drop (so the file cannot open in the window): no import, nothing on air.
  expect(over).toBe(true);
  expect(broadcastWindow.url()).toBe(page);
  await expect(broadcastWindow.locator('.canvas-background, .canvas-overlay')).toHaveCount(0);
  await expect(images(controlWindow).getByRole('listitem')).toHaveCount(0);
  expect(await storedMediaFiles(dataDir)).toEqual([]);
});
