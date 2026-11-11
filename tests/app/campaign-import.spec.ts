import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { rawZip } from '../rawZip';
import {
  createCampaign,
  dropFiles,
  expect,
  fixture,
  launchApp,
  openBroadcastWindow,
  stubFilePicker,
  test,
  type RunningApp,
} from './harness';

const IMAGE = 'red-16x9';

type Bridge = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Calls the Control window's bridge, as the page would. */
function call<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, params]) => (window as unknown as { regie: Bridge }).regie[name](...params) as T,
    [method, args] as const,
  );
}

/** Replaces the native save dialog in the main process: the next ones save to `filePath`. */
async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
  }, filePath);
}

/** Replaces the Windows Recycle Bin with a folder of the test's data folder. */
async function stubRecycleBin(app: ElectronApplication, dataDir: string): Promise<void> {
  await app.evaluate(
    ({ shell }, bin) => {
      shell.trashItem = (folder: string) => {
        const fs = process.getBuiltinModule('node:fs');
        const path = process.getBuiltinModule('node:path');
        fs.mkdirSync(bin, { recursive: true });
        fs.renameSync(folder, path.join(bin, path.basename(folder)));
        return Promise.resolve();
      };
    },
    path.join(dataDir, 'fake-recycle-bin'),
  );
}

function campaignList(page: Page) {
  return page.getByRole('list', { name: 'Campagnes' });
}

function campaignItem(page: Page, name: string) {
  return campaignList(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) });
}

async function backToCampaignList(page: Page) {
  await page.getByRole('button', { name: 'Campagnes' }).click();
  await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
}

/**
 * A Campaign named `name` with the Scenes "Cantina" and "Hangar" (in the Chapter "Prologue") and
 * one imported image, starred as a favourite, left closed on the Campaign list.
 */
async function campaignWithScenesAndAnImage(
  { app, controlWindow: page }: RunningApp,
  name: string,
) {
  await createCampaign(page, name);
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await page.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    page.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Ajouter ${IMAGE} aux favoris` }).click();
  await expect(page.getByRole('button', { name: `Retirer ${IMAGE} des favoris` })).toBeVisible();
  const [campaign] = await call<{ id: string }[]>(page, 'listCampaigns');
  await call(page, 'createScene', campaign.id, 'Cantina');
  const hangar = await call<{ id: string }>(page, 'createScene', campaign.id, 'Hangar');
  const { chapters } = await call<{ chapters: { id: string }[] }>(
    page,
    'editRunningOrder',
    campaign.id,
    { kind: 'create-chapter', name: 'Prologue' },
  );
  await call(page, 'editRunningOrder', campaign.id, {
    kind: 'move-scene',
    sceneId: hangar.id,
    chapterId: chapters[0].id,
    toIndex: 0,
  });
  await backToCampaignList(page);
}

/** Exports the Campaign named `name` from the Campaign list to `file`. */
async function exportTo({ app, controlWindow: page }: RunningApp, name: string, file: string) {
  await stubSaveDialog(app, file);
  await page.getByRole('button', { name: `Exporter ${name}` }).click();
  await expect(page.getByText('Campagne exportée.', { exact: true })).toBeVisible();
}

/** Imports `file` with « Importer une campagne ». */
async function importFrom({ app, controlWindow: page }: RunningApp, file: string) {
  await stubFilePicker(app, [file]);
  await page.getByRole('button', { name: 'Importer une campagne' }).click();
}

/** The Scenes, Chapter and starred image of `campaignWithScenesAndAnImage`. */
async function expectScenesAndImage(page: Page) {
  await expect(page.getByRole('list', { name: 'Scènes de la campagne' })).toContainText('Cantina');
  await expect(page.getByRole('list', { name: 'Scènes du chapitre Prologue' })).toHaveText(
    'Hangar',
  );
  await expect(
    page.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: `Retirer ${IMAGE} des favoris` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

async function filesIn(folder: string): Promise<string[]> {
  try {
    return await fs.readdir(folder);
  } catch {
    return [];
  }
}

test('Export, delete, then Import gives back the Campaign, highlighted, across a restart', async ({
  regie,
}) => {
  const { app, controlWindow: page, dataDir } = regie;
  await campaignWithScenesAndAnImage(regie, 'Les Ombres');
  const zip = path.join(dataDir, 'Les Ombres.zip');
  await exportTo(regie, 'Les Ombres', zip);
  await stubRecycleBin(app, dataDir);
  await page.getByRole('button', { name: 'Supprimer Les Ombres' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Supprimer', exact: true })
    .click();
  await expect(campaignList(page).getByRole('listitem')).toHaveCount(0);

  await importFrom(regie, zip);

  // On the list, highlighted, not opened.
  await expect(page.getByText('Campagne « Les Ombres » importée.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
  await expect(campaignItem(page, 'Les Ombres')).toContainText('Importée');
  expect(await filesIn(path.join(dataDir, 'imports'))).toEqual([]);

  await campaignItem(page, 'Les Ombres')
    .getByRole('button', { name: /^Les Ombres/ })
    .click();
  await expectScenesAndImage(page);

  await app.close();
  const restarted = await launchApp(dataDir);
  try {
    const home = restarted.controlWindow;
    // The only Campaign opens at launch.
    await expectScenesAndImage(home);
    await expect(home.getByRole('heading', { name: 'Les Ombres', exact: true })).toBeVisible();
  } finally {
    await restarted.app.close();
  }
});

test('importing the Export of a Campaign still there adds a second one, « (importée) »', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  await campaignWithScenesAndAnImage(regie, 'Les Ombres');
  const zip = path.join(dataDir, 'Les Ombres.zip');
  await exportTo(regie, 'Les Ombres', zip);

  await importFrom(regie, zip);

  await expect(campaignList(page).getByRole('listitem')).toHaveCount(2);
  await expect(campaignItem(page, 'Les Ombres \\(importée\\)')).toContainText('Importée');
  const folders = await fs.readdir(path.join(dataDir, 'campaigns'));
  expect(new Set(folders).size).toBe(2);
  await campaignItem(page, 'Les Ombres \\(importée\\)')
    .getByRole('button', { name: /^Les Ombres \(importée\)/ })
    .click();
  await expectScenesAndImage(page);
});

test('an imported Campaign whose zip lacks a Media shows it missing', async ({ regie }) => {
  const { controlWindow: page, dataDir } = regie;
  await campaignWithScenesAndAnImage(regie, 'Les Ombres');
  const [id] = await fs.readdir(path.join(dataDir, 'campaigns'));
  const mediaFolder = path.join(dataDir, 'campaigns', id, 'media');
  for (const file of await fs.readdir(mediaFolder)) await fs.rm(path.join(mediaFolder, file));
  const zip = path.join(dataDir, 'Les Ombres.zip');
  await stubSaveDialog(regie.app, zip);
  await page.getByRole('button', { name: 'Exporter Les Ombres' }).click();
  await expect(page.getByText(/1 média introuvable/)).toBeVisible();

  await importFrom(regie, zip);
  await campaignItem(page, 'Les Ombres \\(importée\\)')
    .getByRole('button', { name: /^Les Ombres \(importée\)/ })
    .click();

  await expect(page.getByRole('list', { name: 'Images' })).toContainText('Média manquant');
});

test('a zip trying to write outside its Campaign is refused, leaving nothing behind', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  await createCampaign(page, 'Les Ombres');
  await backToCampaignList(page);
  const before = await fs.readdir(path.join(dataDir, 'campaigns'));
  const zip = path.join(dataDir, 'Piège.zip');
  await fs.writeFile(
    zip,
    rawZip([
      {
        name: 'regie-export.json',
        content: JSON.stringify({
          format: 'regie-jdr-campaign-export',
          formatVersion: 1,
          appVersion: '0.1.0',
          exportedAt: '2026-11-12T20:00:00.000Z',
          campaignName: 'Piège',
          documents: [{ path: 'campaign.json', schemaVersion: 1 }],
          media: [],
        }),
      },
      {
        name: 'campaign.json',
        content: JSON.stringify({
          schemaVersion: 1,
          name: 'Piège',
          theme: 'retro',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      },
      { name: '../../evil.txt', content: 'escaped' },
    ]),
  );

  await importFrom(regie, zip);

  await expect(page.getByRole('alert').filter({ hasText: 'n’a pas pu être lu' })).toBeVisible();
  await expect(campaignList(page).getByRole('listitem')).toHaveCount(1);
  expect(await fs.readdir(path.join(dataDir, 'campaigns'))).toEqual(before);
  expect(await filesIn(path.join(dataDir, 'imports'))).toEqual([]);
  await expect(fs.access(path.join(path.dirname(dataDir), 'evil.txt'))).rejects.toThrow();
});

test('an Export from a newer version of the app is refused with a clear message', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  const zip = path.join(dataDir, 'Future.zip');
  await fs.writeFile(
    zip,
    rawZip([
      {
        name: 'regie-export.json',
        content: JSON.stringify({
          format: 'regie-jdr-campaign-export',
          formatVersion: 99,
          appVersion: '9.0.0',
          exportedAt: '2030-01-01T00:00:00.000Z',
          campaignName: 'Futur',
          documents: [],
          media: [],
        }),
      },
    ]),
  );

  await importFrom(regie, zip);

  await expect(page.getByRole('alert').filter({ hasText: 'version plus récente' })).toBeVisible();
  expect(await filesIn(path.join(dataDir, 'campaigns'))).toEqual([]);
  expect(await filesIn(path.join(dataDir, 'imports'))).toEqual([]);
});

/** The Campaign list page, where Exports dropped from Explorer are taken. */
function campaignHome(page: Page) {
  return page.getByRole('heading', { name: 'Vos campagnes' });
}

/** Drops `files` from Explorer on the Campaign list; the page takes the drop. */
async function dropOnCampaignList(page: Page, files: string[]) {
  expect(await dropFiles(campaignHome(page), files)).toBe(true);
}

test('an Export dropped on the Campaign list is imported as through the dialog', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  await campaignWithScenesAndAnImage(regie, 'Les Ombres');
  const zip = path.join(dataDir, 'Les Ombres.zip');
  await exportTo(regie, 'Les Ombres', zip);

  await dropOnCampaignList(page, [zip]);

  await expect(page.getByText('Campagne « Les Ombres (importée) » importée.')).toBeVisible();
  await expect(campaignItem(page, 'Les Ombres \\(importée\\)')).toContainText('Importée');
  await expect(campaignHome(page)).toBeVisible();
  expect(await filesIn(path.join(dataDir, 'imports'))).toEqual([]);
  await campaignItem(page, 'Les Ombres \\(importée\\)')
    .getByRole('button', { name: /^Les Ombres \(importée\)/ })
    .click();
  await expectScenesAndImage(page);
});

test('a dropped file that is not a zip is refused with a message, importing nothing', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  const notes = path.join(dataDir, 'notes.txt');
  await fs.writeFile(notes, 'pas une campagne');

  await dropOnCampaignList(page, [notes]);

  await expect(page.getByRole('alert')).toContainText(
    '« notes.txt » n’a pas été importé : ce n’est pas une campagne exportée (.zip).',
  );
  expect(await filesIn(path.join(dataDir, 'campaigns'))).toEqual([]);
  expect(await filesIn(path.join(dataDir, 'imports'))).toEqual([]);
});

test('a non-zip renamed .zip and several dropped files are refused, importing nothing', async ({
  regie,
}) => {
  const { controlWindow: page, dataDir } = regie;
  const fake = path.join(dataDir, 'Faux.zip');
  await fs.writeFile(fake, 'pas une archive');

  await dropOnCampaignList(page, [fake]);
  await expect(page.getByRole('alert')).toContainText('n’a pas pu être lu');

  await dropOnCampaignList(page, [fake, fixture(`${IMAGE}.png`)]);
  await expect(page.getByRole('alert')).toContainText(
    'Déposez une seule campagne exportée à la fois : rien n’a été importé.',
  );
  expect(await filesIn(path.join(dataDir, 'campaigns'))).toEqual([]);
  expect(await filesIn(path.join(dataDir, 'imports'))).toEqual([]);
});

test('an Export dropped on the Broadcast window is not imported', async ({ regie }) => {
  const { app, controlWindow: page, dataDir } = regie;
  await campaignWithScenesAndAnImage(regie, 'Les Ombres');
  const zip = path.join(dataDir, 'Les Ombres.zip');
  await exportTo(regie, 'Les Ombres', zip);
  await campaignItem(page, 'Les Ombres')
    .getByRole('button', { name: /^Les Ombres/ })
    .click();
  const broadcastWindow = await openBroadcastWindow(app, page);
  const shown = broadcastWindow.url();

  // The page-wide guard takes the drop so the zip cannot open in the window; nothing imports it.
  expect(await dropFiles(broadcastWindow.locator('main.broadcast-screen'), [zip])).toBe(true);

  expect(broadcastWindow.url()).toBe(shown);
  await backToCampaignList(page);
  await expect(campaignList(page).getByRole('listitem')).toHaveCount(1);
  expect(await filesIn(path.join(dataDir, 'campaigns'))).toHaveLength(1);
  expect(await filesIn(path.join(dataDir, 'imports'))).toEqual([]);
});
