import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { createCampaign, expect, fixture, launchApp, stubFilePicker, test } from './harness';

/** The open Campaign's Media library. */
function library(page: Page) {
  return page.getByRole('list', { name: 'Médias' });
}

function mediaItem(page: Page, name: string) {
  return library(page).getByRole('listitem').filter({ hasText: name });
}

/** Writes a file to pick in the file picker (outside the Campaigns, removed with the test). */
async function pickable(dataDir: string, name: string, content: string): Promise<string> {
  const folder = path.join(dataDir, 'picked');
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

async function importImages(page: Page) {
  await page.getByRole('button', { name: 'Importer des images' }).click();
}

async function importSounds(page: Page, role: 'Musique' | 'Bruitage' | 'Ambiance') {
  await page.getByLabel('Rôle des sons importés').selectOption({ label: role });
  await page.getByRole('button', { name: 'Importer des sons' }).click();
}

test('an imported image is in the library, loads, and is still there after a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir, failedRequests, cspViolations } = regie;
  await createCampaign(controlWindow);
  await stubFilePicker(app, [fixture('red-16x9.png')]);

  await importImages(controlWindow);

  const thumbnail = mediaItem(controlWindow, 'red-16x9').getByRole('img', { name: 'red-16x9' });
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(16);
  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    // The only Campaign opens directly, with its library.
    const page = restarted.controlWindow;
    const image = mediaItem(page, 'red-16x9').getByRole('img', { name: 'red-16x9' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(16);
    await expect(library(page).getByRole('listitem')).toHaveCount(1);
    expect(restarted.failedRequests).toEqual([]);
  } finally {
    await restarted.app.close();
  }
});

test('importing the same file twice keeps one Media and one file', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  await stubFilePicker(app, [fixture('red-16x9.png')]);

  await importImages(controlWindow);
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(1);
  await importImages(controlWindow);

  // The second import changes nothing, even after the library is read again.
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(1);
  expect(await storedMediaFiles(dataDir)).toHaveLength(1);
});

test('the same file imported into two Campaigns is stored in both', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await stubFilePicker(app, [fixture('red-16x9.png')]);
  await createCampaign(controlWindow, 'Star Wars');
  await importImages(controlWindow);
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(1);

  await controlWindow.getByRole('button', { name: 'Campagnes' }).click();
  await createCampaign(controlWindow, 'Warhammer');
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(0);
  await importImages(controlWindow);

  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(1);
  expect(await storedMediaFiles(dataDir)).toHaveLength(2);
});

test('an unsupported file is refused with a message and the other files are imported', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  const gif = await pickable(dataDir, 'animation.gif', 'GIF89a');
  await stubFilePicker(app, [gif, fixture('red-16x9.png')]);

  await importImages(controlWindow);

  await expect(controlWindow.getByRole('alert')).toContainText(
    '« animation.gif » n’a pas été importé : ce type de fichier n’est pas pris en charge',
  );
  await expect(library(controlWindow).getByRole('listitem')).toHaveCount(1);
  await expect(mediaItem(controlWindow, 'red-16x9')).toBeVisible();
});

test('an image category can be changed at any time and is kept after a restart', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  await stubFilePicker(app, [fixture('red-16x9.png')]);
  await importImages(controlWindow);

  const category = controlWindow.getByLabel('Catégorie de red-16x9');
  await expect(category).toHaveValue('scenery');
  await category.selectOption({ label: 'Personnage' });
  await expect(category).toHaveValue('character');

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    const page = restarted.controlWindow;
    const restored = page.getByLabel('Catégorie de red-16x9');
    await expect(restored).toHaveValue('character');
    await restored.selectOption({ label: 'Décors' });
    await expect(restored).toHaveValue('scenery');
  } finally {
    await restarted.app.close();
  }
});

test('audio gets the role chosen at import, which cannot be changed afterwards', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir } = regie;
  await createCampaign(controlWindow);
  await stubFilePicker(app, [await pickable(dataDir, 'Pluie.ogg', 'pluie')]);
  await importSounds(controlWindow, 'Ambiance');
  await stubFilePicker(app, [await pickable(dataDir, 'Taverne.mp3', 'taverne')]);
  await importSounds(controlWindow, 'Musique');
  await stubFilePicker(app, [await pickable(dataDir, 'Épée.wav', 'épée')]);
  await importSounds(controlWindow, 'Bruitage');

  await expect(mediaItem(controlWindow, 'Pluie')).toContainText('Ambiance');
  await expect(mediaItem(controlWindow, 'Taverne')).toContainText('Musique');
  await expect(mediaItem(controlWindow, 'Épée')).toContainText('Bruitage');
  // A role is not a choice once imported: no control to change it.
  await expect(mediaItem(controlWindow, 'Pluie').getByRole('combobox')).toHaveCount(0);

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    await expect(mediaItem(restarted.controlWindow, 'Pluie')).toContainText('Ambiance');
    await expect(library(restarted.controlWindow).getByRole('listitem')).toHaveCount(3);
  } finally {
    await restarted.app.close();
  }
});

test('Media addresses serve only the Campaign media files, with their content type', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await createCampaign(controlWindow);
  await stubFilePicker(app, [fixture('red-16x9.png')]);
  await importImages(controlWindow);
  const thumbnail = mediaItem(controlWindow, 'red-16x9').getByRole('img');
  const address = await thumbnail.getAttribute('src');
  expect(address).toMatch(/^regie-asset:\/\/media\/[0-9a-f-]+\/[0-9a-f]{64}\.png$/);

  // Requested from the main process, as a window would (the page itself is a file:// origin).
  const responses = await app.evaluate(async ({ net }, url) => {
    const campaignFolder = url.slice(0, url.lastIndexOf('/'));
    const statusOf = async (target: string) => {
      const response = await net.fetch(target);
      return [response.status, response.headers.get('content-type')];
    };
    return {
      existing: await statusOf(url),
      campaignDocument: await statusOf(`${campaignFolder}/campaign.json`),
      escape: await statusOf(`${campaignFolder}/..%2F..%2Fsettings.json`),
      missing: await statusOf(`${campaignFolder}/${'0'.repeat(64)}.png`),
    };
  }, address!);

  expect(responses).toEqual({
    existing: [200, 'image/png'],
    campaignDocument: [404, null],
    escape: [404, null],
    missing: [404, null],
  });
});

test('a Media file deleted outside the app shows the missing placeholder in the Control window', async ({
  regie,
}) => {
  const { app, controlWindow, dataDir, cspViolations } = regie;
  await createCampaign(controlWindow);
  await stubFilePicker(app, [fixture('red-16x9.png')]);
  await importImages(controlWindow);
  await expect(mediaItem(controlWindow, 'red-16x9').getByRole('img')).toBeVisible();

  const [campaignId] = await fs.readdir(path.join(dataDir, 'campaigns'));
  const mediaFolder = path.join(dataDir, 'campaigns', campaignId, 'media');
  for (const file of await fs.readdir(mediaFolder)) await fs.rm(path.join(mediaFolder, file));
  await controlWindow.reload();

  const item = mediaItem(controlWindow, 'red-16x9');
  await expect(item.getByRole('img', { name: 'Média manquant : red-16x9' })).toBeVisible();
  await expect(item).toContainText('Média manquant');
  // No <img> left to show a broken-image icon.
  await expect(item.locator('img')).toHaveCount(0);
  expect(cspViolations).toEqual([]);
});
