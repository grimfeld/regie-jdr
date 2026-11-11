import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  expect,
  fixture,
  launchApp,
  picturePng,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

function library(page: Page) {
  return page.getByRole('list', { name: 'Images' });
}

function libraryItem(page: Page, name: string) {
  return library(page).getByRole('listitem').filter({ hasText: name });
}

function shownNames(page: Page) {
  return library(page).locator('.media-name').allTextContents();
}

async function importImages(page: Page) {
  await page.getByRole('button', { name: 'Importer des images' }).click();
}

async function naturalWidth(page: Page, name: string): Promise<number> {
  return libraryItem(page, name)
    .getByRole('img', { name, exact: true })
    .evaluate((img: HTMLImageElement) => img.naturalWidth);
}

async function thumbnailFiles(dataDir: string): Promise<string[]> {
  const [campaignId] = await fs.readdir(path.join(dataDir, 'campaigns'));
  return fs
    .readdir(path.join(dataDir, 'campaigns', campaignId, 'thumbnails'))
    .catch(() => [] as string[]);
}

/** Changes an image's category from the library. */
async function setCategory(page: Page, name: string, label: 'Décors' | 'Personnage') {
  await page.getByLabel(`Catégorie de ${name}`).selectOption({ label });
}

/** Restarts the app on the same data folder; the caller closes the returned app. */
async function restart(running: RunningApp): Promise<RunningApp> {
  await running.app.close();
  return launchApp(running.dataDir);
}

test('imported images get a thumbnail, kept after a restart and made again when deleted', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir, failedRequests } = regie;
  await createCampaign(controlWindow);
  const map = await picturePng(regie, 'Carte.png', { width: 1600, height: 900 });
  await stubFilePicker(app, [map, fixture('red-16x9.png')]);

  await importImages(controlWindow);

  // The library shows thumbnails: a large image comes down to 320 px, a small one stays.
  const thumbnail = libraryItem(controlWindow, 'Carte').getByRole('img', { name: 'Carte' });
  await expect(thumbnail).toHaveAttribute('src', /^regie-media:\/\/thumbnail\//);
  await expect.poll(() => naturalWidth(controlWindow, 'Carte')).toBe(320);
  await expect.poll(() => naturalWidth(controlWindow, 'red-16x9')).toBe(16);
  const made = await thumbnailFiles(dataDir);
  expect(made).toHaveLength(2);
  expect(made.every((file) => /^[0-9a-f]{64}\.png$/.test(file))).toBe(true);

  const restarted = await restart(regie);
  try {
    const page = restarted.controlWindow;
    await expect.poll(() => naturalWidth(page, 'Carte')).toBe(320);
    expect(await thumbnailFiles(dataDir)).toEqual(made);

    // Thumbnails deleted outside the app: the library makes them again.
    const [campaignId] = await fs.readdir(path.join(dataDir, 'campaigns'));
    await fs.rm(path.join(dataDir, 'campaigns', campaignId, 'thumbnails'), { recursive: true });
    await page.reload();

    await expect.poll(() => naturalWidth(page, 'Carte')).toBe(320);
    await expect.poll(() => naturalWidth(page, 'red-16x9')).toBe(16);
    await expect(library(page)).not.toContainText('Média manquant');
    expect((await thumbnailFiles(dataDir)).sort()).toEqual([...made].sort());
    expect(restarted.failedRequests).toEqual([]);
  } finally {
    await restarted.app.close();
  }
  expect(failedRequests).toEqual([]);
});

test('the library filters by All, Scenery or Character and searches names ignoring case and accents', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow);
  const size = { width: 32, height: 18 };
  await stubFilePicker(app, [
    await picturePng(regie, 'Château hanté.png', size, { red: 200, green: 40, blue: 10 }),
    await picturePng(regie, 'Orc.png', size, { red: 200, green: 40, blue: 20 }),
    await picturePng(regie, 'Forêt.png', size, { red: 200, green: 40, blue: 30 }),
  ]);
  await importImages(controlWindow);
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(3);
  await setCategory(controlWindow, 'Orc', 'Personnage');

  const filter = controlWindow.getByRole('group', { name: 'Filtrer les images' });
  await filter.getByRole('button', { name: 'Personnages' }).click();
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Orc']);
  await filter.getByRole('button', { name: 'Décors' }).click();
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Château hanté', 'Forêt']);
  await filter.getByRole('button', { name: 'Tous' }).click();
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Château hanté', 'Orc', 'Forêt']);

  const search = controlWindow.getByRole('searchbox', { name: 'Rechercher une image' });
  await search.fill('CHATEAU');
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Château hanté']);
  await search.fill('foret');
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Forêt']);

  // Filter and search together.
  await filter.getByRole('button', { name: 'Personnages' }).click();
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(0);
  await expect(controlWindow.getByText('Aucune image ne correspond')).toBeVisible();
  await search.fill('');
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Orc']);
});

test('renaming a Media changes its shown name, survives a restart and keeps the original file name', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow);
  await stubFilePicker(app, [fixture('red-16x9.png')]);
  await importImages(controlWindow);

  await controlWindow.getByRole('button', { name: 'Renommer red-16x9' }).click();
  const input = controlWindow.getByLabel('Nouveau nom de red-16x9');
  await input.fill('Port de nuit');
  await input.press('Enter');

  const item = libraryItem(controlWindow, 'Port de nuit');
  await expect(item.getByRole('img', { name: 'Port de nuit' })).toBeVisible();
  await expect(library(controlWindow)).not.toContainText('red-16x9');
  // Search goes by the new name.
  await controlWindow.getByRole('searchbox', { name: 'Rechercher une image' }).fill('port');
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Port de nuit']);

  // An empty name is refused; the name stays.
  await controlWindow.getByRole('button', { name: 'Renommer Port de nuit' }).click();
  await controlWindow.getByLabel('Nouveau nom de Port de nuit').fill('   ');
  await controlWindow.getByLabel('Nouveau nom de Port de nuit').press('Enter');
  await expect(controlWindow.getByRole('alert')).toContainText(
    'Le nom du média ne peut pas être vide.',
  );
  await expect.poll(() => shownNames(controlWindow)).toEqual(['Port de nuit']);

  const restarted = await restart(regie);
  try {
    const page = restarted.controlWindow;
    const name = libraryItem(page, 'Port de nuit').locator('.media-name');
    await expect(name).toHaveText('Port de nuit');
    await expect(name).toHaveAttribute('title', /Fichier d’origine : red-16x9\.png/);
  } finally {
    await restarted.app.close();
  }
});
