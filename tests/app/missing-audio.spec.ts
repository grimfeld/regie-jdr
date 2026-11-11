import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createCampaign,
  dropAndWait,
  expect,
  stubFilePicker,
  test,
  writeToneWav,
  type RunningApp,
} from './harness';

function editor(page: Page) {
  return page.getByRole('region', { name: 'Scène ouverte' });
}

function musicList(page: Page) {
  return editor(page).getByRole('list', { name: 'Musiques' });
}

function soundInLibrary(page: Page, name: string) {
  return page.getByRole('list', { name: 'Sons' }).getByRole('listitem').filter({ hasText: name });
}

/** A sound of the "En cours" strip, by its Media name. */
function sounding(page: Page, name: string) {
  return page.getByRole('region', { name: 'En cours' }).getByRole('listitem').filter({
    hasText: name,
  });
}

/** Imports `files` with the role chosen as `role` (its button in the role dialog). */
async function importSounds({ app, controlWindow }: RunningApp, files: string[], role: string) {
  await stubFilePicker(app, files);
  await controlWindow.getByRole('button', { name: 'Importer des sons' }).click();
  await controlWindow
    .getByRole('dialog', { name: 'Rôle des sons' })
    .getByRole('button', { name: role })
    .click();
  for (const file of files) {
    await expect(soundInLibrary(controlWindow, path.parse(file).name)).toBeVisible();
  }
}

async function campaignFolder({ dataDir }: RunningApp) {
  const [campaignId] = await fs.readdir(path.join(dataDir, 'campaigns'));
  return path.join(dataDir, 'campaigns', campaignId);
}

/** The Campaign's Media index as stored. */
async function storedMedia(regie: RunningApp) {
  const file = path.join(await campaignFolder(regie), 'media.json');
  const { media } = JSON.parse(await fs.readFile(file, 'utf8')) as {
    media: { id: string; name: string; contentHash: string; extension: string }[];
  };
  return media;
}

function ambienceList(page: Page) {
  return editor(page).getByRole('list', { name: 'Ambiances' });
}

/** A Campaign with Scene "Taverne": Music Auberge, and Ambience Pluie switched on. */
async function tavern(regie: RunningApp) {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  const folder = path.join(dataDir, 'sons-a-importer');
  await fs.mkdir(folder, { recursive: true });
  await importSounds(regie, [await writeToneWav(folder, 'Auberge', 330)], 'Musique');
  await importSounds(regie, [await writeToneWav(folder, 'Pluie', 550)], 'Ambiance');

  const panel = controlWindow.getByRole('region', { name: 'Scènes' });
  await panel.getByLabel('Nom de la scène').fill('Taverne');
  await panel.getByRole('button', { name: 'Créer la scène' }).click();
  await expect(editor(controlWindow).getByRole('heading', { name: 'Taverne' })).toBeVisible();
  await dropAndWait(
    soundInLibrary(controlWindow, 'Auberge').locator('.media-audio-icon'),
    musicList(controlWindow).locator('xpath=..'),
    musicList(controlWindow).getByRole('listitem').filter({ hasText: 'Auberge' }),
  );
  await expect(musicList(controlWindow).getByRole('listitem')).toHaveText([/Auberge/]);

  const playRain = ambienceList(controlWindow).getByRole('checkbox', { name: 'Jouer Pluie' });
  await dropAndWait(
    soundInLibrary(controlWindow, 'Pluie').locator('.media-audio-icon'),
    ambienceList(controlWindow).locator('xpath=..'),
    playRain,
  );
  await playRain.check();
  await expect(playRain).toBeChecked();
}

/** Deletes the file of the Media named `name`, as the Game Master could in Explorer. */
async function deleteFileOf(regie: RunningApp, name: string) {
  const item = (await storedMedia(regie)).find((media) => media.name === name);
  if (!item) throw new Error(`No Media named ${name}`);
  const file = path.join(
    await campaignFolder(regie),
    'media',
    `${item.contentHash}${item.extension}`,
  );
  await fs.rm(file);
}

test('a sound whose file was deleted is badged, left out on Activate with a notice; the others play', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await tavern(regie);
  await deleteFileOf(regie, 'Auberge');
  await controlWindow.reload();

  await expect(
    soundInLibrary(controlWindow, 'Auberge').getByRole('img', {
      name: 'Média manquant : Auberge',
    }),
  ).toBeVisible();
  await expect(
    musicList(controlWindow).getByRole('img', { name: 'Média manquant : Auberge' }),
  ).toBeVisible();
  await expect(ambienceList(controlWindow)).not.toContainText('Média manquant');
  await expect(soundInLibrary(controlWindow, 'Pluie')).not.toContainText('Média manquant');

  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();

  await expect(controlWindow.getByRole('alert')).toContainText('« Auberge » est introuvable');
  await expect(sounding(controlWindow, 'Pluie')).toHaveAttribute('data-state', 'playing');
  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'missing');
  await expect(sounding(controlWindow, 'Auberge')).toContainText('média manquant');
  // Told once, though several panels follow what is sounding.
  await expect(controlWindow.getByRole('alert').filter({ hasText: 'Auberge' })).toHaveCount(1);
});

test('a sound the audio engine cannot read is skipped with a notice; the others play', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await tavern(regie);
  // Still there, but no longer a sound: the engine fails to load it.
  const item = (await storedMedia(regie)).find((media) => media.name === 'Auberge');
  await fs.writeFile(
    path.join(await campaignFolder(regie), 'media', `${item?.contentHash}${item?.extension}`),
    'pas un son',
  );

  await editor(controlWindow).getByRole('button', { name: 'Activer' }).click();

  await expect(controlWindow.getByRole('alert')).toContainText('« Auberge » n’a pas pu être lu');
  await expect(sounding(controlWindow, 'Auberge')).toHaveAttribute('data-state', 'failed');
  await expect(sounding(controlWindow, 'Pluie')).toHaveAttribute('data-state', 'playing');
});

test('an Ambience whose file was deleted is badged in the Scene’s Ambience list', async ({
  regie,
}) => {
  const { controlWindow } = regie;
  await tavern(regie);
  await deleteFileOf(regie, 'Pluie');
  // Coming back to the window asks again, as after deleting the file in Explorer.
  await controlWindow.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(
    ambienceList(controlWindow).getByRole('img', { name: 'Média manquant : Pluie' }),
  ).toBeVisible();
  await expect(musicList(controlWindow)).not.toContainText('Média manquant');
});

test('a Soundboard pad whose file was deleted is badged; pressing it says so', async ({
  regie,
}) => {
  const { controlWindow, dataDir } = regie;
  await createCampaign(controlWindow, 'Star Wars');
  const folder = path.join(dataDir, 'sons-a-importer');
  await fs.mkdir(folder, { recursive: true });
  await importSounds(regie, [await writeToneWav(folder, 'Épée', 660)], 'Bruitage');
  const soundboard = controlWindow.getByRole('region', { name: 'Table de bruitages' });
  const pad = soundboard.getByRole('button', { name: 'Jouer Épée' });
  await dropAndWait(
    soundInLibrary(controlWindow, 'Épée').locator('.media-audio-icon'),
    soundboard,
    pad,
    { targetPosition: { x: 40, y: 20 } },
  );
  await expect(pad).not.toContainText('Média manquant');

  await deleteFileOf(regie, 'Épée');
  await controlWindow.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(pad.getByRole('img', { name: 'Média manquant : Épée' })).toBeVisible();

  await pad.click();
  await expect(controlWindow.getByRole('alert')).toContainText('« Épée » est introuvable');
  await expect(pad).toHaveAttribute('aria-pressed', 'false');
});
