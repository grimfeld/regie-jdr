import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { wavFile } from '../unit/audioFiles';
import {
  createCampaign,
  expect,
  launchApp,
  picturePng,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

function images(page: Page) {
  return page.getByRole('list', { name: 'Images' });
}

function sounds(page: Page) {
  return page.getByRole('list', { name: 'Sons' });
}

function shownNames(list: ReturnType<typeof images>) {
  return list.locator('.media-name').allTextContents();
}

async function star(page: Page, name: string) {
  await page.getByRole('button', { name: `Ajouter ${name} aux favoris` }).click();
  await expect(page.getByRole('button', { name: `Retirer ${name} des favoris` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

async function favouritesOnly(page: Page, what: 'images' | 'sons') {
  await page
    .getByRole('group', { name: `Favoris parmi les ${what}` })
    .getByRole('button', { name: 'Favoris' })
    .click();
}

async function filter(page: Page, what: 'images' | 'sons', label: string) {
  await page
    .getByRole('group', { name: `Filtrer les ${what}` })
    .getByRole('button', { name: label })
    .click();
}

/** Three images (two Scenery, one Character) and three sounds (two Music, one Ambience). */
async function libraryOfSix(regie: RunningApp) {
  const { app, controlWindow: page, dataDir } = regie;
  const size = { width: 32, height: 18 };
  await stubFilePicker(app, [
    await picturePng(regie, 'Château.png', size, { red: 10, green: 20, blue: 30 }),
    await picturePng(regie, 'Forêt.png', size, { red: 40, green: 50, blue: 60 }),
    await picturePng(regie, 'Orc du château.png', size, { red: 70, green: 80, blue: 90 }),
  ]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  await expect.poll(() => shownNames(images(page))).toHaveLength(3);
  await page.getByLabel('Catégorie de Orc du château').selectOption({ label: 'Personnage' });

  const folder = path.join(dataDir, 'sons');
  await fs.mkdir(folder, { recursive: true });
  const sound = async (name: string, seconds: number) => {
    const file = path.join(folder, name);
    await fs.writeFile(file, wavFile(seconds));
    return file;
  };
  await stubFilePicker(app, [await sound('Taverne.wav', 3), await sound('Bataille.wav', 4)]);
  await page.getByRole('button', { name: 'Importer des sons' }).click();
  await page
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: 'Musique' })
    .click();
  await stubFilePicker(app, [await sound('Pluie.wav', 5)]);
  await page.getByRole('button', { name: 'Importer des sons' }).click();
  await page
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: 'Ambiance' })
    .click();
  await expect.poll(() => shownNames(sounds(page))).toHaveLength(3);
}

test('starred images and sounds show under « Favoris », combined with the filter and the search, and stay favourites after a restart', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  await createCampaign(page);
  await libraryOfSix(regie);

  await star(page, 'Château');
  await star(page, 'Orc du château');
  await star(page, 'Bataille');
  await star(page, 'Pluie');

  // Favourites alone.
  await favouritesOnly(page, 'images');
  await expect.poll(() => shownNames(images(page))).toEqual(['Château', 'Orc du château']);
  await favouritesOnly(page, 'sons');
  await expect.poll(() => shownNames(sounds(page))).toEqual(['Bataille', 'Pluie']);

  // Combined with the category or role filter, then with the search too.
  await filter(page, 'images', 'Décors');
  await expect.poll(() => shownNames(images(page))).toEqual(['Château']);
  await filter(page, 'images', 'Tous');
  await page.getByLabel('Rechercher une image').fill('orc');
  await expect.poll(() => shownNames(images(page))).toEqual(['Orc du château']);
  await filter(page, 'images', 'Décors');
  await expect(page.getByText('Aucune image ne correspond')).toBeVisible();
  await filter(page, 'sons', 'Musiques');
  await expect.poll(() => shownNames(sounds(page))).toEqual(['Bataille']);
  await page.getByLabel('Rechercher un son').fill('taverne');
  await expect(page.getByText('Aucun son ne correspond')).toBeVisible();

  // Unstarring takes a Media out of the favourites at once.
  await page.getByLabel('Rechercher une image').fill('');
  await filter(page, 'images', 'Tous');
  await page.getByRole('button', { name: 'Retirer Château des favoris' }).click();
  await expect.poll(() => shownNames(images(page))).toEqual(['Orc du château']);

  // Off again: every Media shows.
  await favouritesOnly(page, 'images');
  await expect.poll(() => shownNames(images(page))).toEqual(['Château', 'Forêt', 'Orc du château']);

  await regie.app.close();
  const restarted = await launchApp(dataDir);
  try {
    const home = restarted.controlWindow;
    await expect.poll(() => shownNames(images(home))).toHaveLength(3);
    await favouritesOnly(home, 'images');
    await expect.poll(() => shownNames(images(home))).toEqual(['Orc du château']);
    await favouritesOnly(home, 'sons');
    await expect.poll(() => shownNames(sounds(home))).toEqual(['Bataille', 'Pluie']);
  } finally {
    await restarted.app.close();
  }
});
