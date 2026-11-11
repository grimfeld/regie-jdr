import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { wavFile } from '../unit/audioFiles';
import { createCampaign, dropFiles, expect, launchApp, stubFilePicker, test } from './harness';

type Role = 'Musique' | 'Ambiance' | 'Bruitage';

/** Writes a sound to pick or drop, outside the Campaigns, as found in the Game Master's folders. */
async function soundOnDisk(dataDir: string, name: string, content: Buffer): Promise<string> {
  const folder = path.join(dataDir, 'sons');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await fs.writeFile(file, content);
  return file;
}

function sounds(page: Page) {
  return page.getByRole('list', { name: 'Sons' });
}

function sound(page: Page, name: string) {
  return sounds(page).getByRole('listitem').filter({ hasText: name });
}

function shownSounds(page: Page) {
  return sounds(page).locator('.media-name').allTextContents();
}

async function chooseRole(page: Page, role: Role) {
  await page
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: role })
    .click();
}

async function filterSounds(page: Page, label: 'Tous' | 'Musiques' | 'Ambiances' | 'Bruitages') {
  await page
    .getByRole('group', { name: 'Filtrer les sons' })
    .getByRole('button', { name: label })
    .click();
}

test('sounds imported with each role show their role and duration, can be filtered, searched and renamed, and survive a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);

  // With the picker: the role is asked before picking.
  await stubFilePicker(app, [await soundOnDisk(dataDir, 'Taverne animée.wav', wavFile(125))]);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await chooseRole(controlWindow, 'Musique');
  await expect(sound(controlWindow, 'Taverne animée')).toBeVisible();
  // Dropped from Explorer: the role is asked for the dropped sounds.
  await dropFiles(controlWindow.getByRole('region', { name: 'Bibliothèque' }), [
    await soundOnDisk(dataDir, 'Pluie sur la forêt.wav', wavFile(7)),
  ]);
  await chooseRole(controlWindow, 'Ambiance');
  await expect(sound(controlWindow, 'Pluie sur la forêt')).toBeVisible();
  await stubFilePicker(app, [await soundOnDisk(dataDir, 'Épée.wav', wavFile(1.2))]);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await chooseRole(controlWindow, 'Bruitage');

  await expect(sound(controlWindow, 'Taverne animée')).toContainText('Musique');
  await expect(sound(controlWindow, 'Taverne animée')).toContainText('2:05');
  await expect(sound(controlWindow, 'Pluie sur la forêt')).toContainText('Ambiance');
  await expect(sound(controlWindow, 'Pluie sur la forêt')).toContainText('0:07');
  await expect(sound(controlWindow, 'Épée')).toContainText('Bruitage');
  await expect(sound(controlWindow, 'Épée')).toContainText('0:01');
  // The role is fixed: nothing in the library changes it.
  await expect(sounds(controlWindow).getByRole('combobox')).toHaveCount(0);

  await filterSounds(controlWindow, 'Musiques');
  expect(await shownSounds(controlWindow)).toEqual(['Taverne animée']);
  await filterSounds(controlWindow, 'Ambiances');
  expect(await shownSounds(controlWindow)).toEqual(['Pluie sur la forêt']);
  await filterSounds(controlWindow, 'Bruitages');
  expect(await shownSounds(controlWindow)).toEqual(['Épée']);
  await filterSounds(controlWindow, 'Tous');
  await expect(sounds(controlWindow).getByRole('listitem')).toHaveCount(3);

  // Search ignores case and accents, and combines with the filter.
  const search = controlWindow.getByLabel('Rechercher un son');
  await search.fill('FORET');
  expect(await shownSounds(controlWindow)).toEqual(['Pluie sur la forêt']);
  await search.fill('epee');
  expect(await shownSounds(controlWindow)).toEqual(['Épée']);
  await filterSounds(controlWindow, 'Musiques');
  await expect(sounds(controlWindow).getByRole('listitem')).toHaveCount(0);
  await expect(controlWindow.getByText('Aucun son ne correspond')).toBeVisible();
  await filterSounds(controlWindow, 'Tous');
  await search.fill('');

  await sound(controlWindow, 'Taverne animée')
    .getByRole('button', { name: 'Renommer Taverne animée' })
    .click();
  const rename = controlWindow.getByLabel('Nouveau nom de Taverne animée');
  await rename.fill('Auberge du Poney');
  await rename.press('Enter');
  await expect(sound(controlWindow, 'Auberge du Poney')).toContainText('Musique');

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    await expect(sounds(page).getByRole('listitem')).toHaveCount(3);
    await expect(sound(page, 'Auberge du Poney')).toContainText('Musique');
    await expect(sound(page, 'Auberge du Poney')).toContainText('2:05');
    await expect(sound(page, 'Pluie sur la forêt')).toContainText('Ambiance');
    await expect(sound(page, 'Épée')).toContainText('Bruitage');
  } finally {
    await restarted.app.close();
  }
});

test('importing the same sound again keeps one Media, with its first role', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  const rain = await soundOnDisk(dataDir, 'Pluie.wav', wavFile(3));
  const copy = await soundOnDisk(dataDir, 'Pluie copie.wav', wavFile(3));

  await stubFilePicker(app, [rain]);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await chooseRole(controlWindow, 'Ambiance');
  await expect(sounds(controlWindow).getByRole('listitem')).toHaveCount(1);
  await dropFiles(controlWindow.getByRole('region', { name: 'Bibliothèque' }), [copy]);
  await chooseRole(controlWindow, 'Musique');
  // Imports into a Campaign run one after another: once a new sound shows, the others are done.
  await stubFilePicker(app, [await soundOnDisk(dataDir, 'Cloche.wav', wavFile(2))]);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await chooseRole(controlWindow, 'Bruitage');

  await expect(sounds(controlWindow).getByRole('listitem')).toHaveCount(2);
  await expect(sound(controlWindow, 'Pluie')).toContainText('Ambiance');
  const [campaignId] = await fs.readdir(path.join(dataDir, 'campaigns'));
  expect(await fs.readdir(path.join(dataDir, 'campaigns', campaignId, 'media'))).toHaveLength(2);
});

test('sounds dropped while the role is still being asked are asked about in turn, none lost', async ({
  regie,
}) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  const library = controlWindow.getByRole('region', { name: 'Bibliothèque' });
  const roleDialog = controlWindow.getByRole('dialog', { name: 'Rôle des sons' });

  await dropFiles(library, [await soundOnDisk(dataDir, 'Taverne.wav', wavFile(3))]);
  await expect(roleDialog).toContainText('ce son');
  // A second drop before the first question is answered.
  await dropFiles(library, [
    await soundOnDisk(dataDir, 'Pluie.wav', wavFile(4)),
    await soundOnDisk(dataDir, 'Vent.wav', wavFile(5)),
  ]);

  // The first drop's question stays until answered, then the second's comes.
  await expect(roleDialog).toContainText('ce son');
  await chooseRole(controlWindow, 'Musique');
  await expect(roleDialog).toContainText('ces 2 sons');
  await chooseRole(controlWindow, 'Ambiance');

  await expect(roleDialog).toHaveCount(0);
  await expect(sound(controlWindow, 'Taverne')).toContainText('Musique');
  await expect(sound(controlWindow, 'Pluie')).toContainText('Ambiance');
  await expect(sound(controlWindow, 'Vent')).toContainText('Ambiance');
});
