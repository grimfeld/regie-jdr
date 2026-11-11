import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { readZipEntries } from '../zipEntries';
import { createCampaign, expect, fixture, stubFilePicker, test, type RunningApp } from './harness';

const IMAGE = 'red-16x9';

/**
 * Replaces the native save dialog in the main process: the next ones save to `filePath`. Keeps
 * the default path each was offered, read back with `offeredSavePaths`.
 */
async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const offered: string[] = [];
    Object.assign(globalThis, { offeredSavePaths: offered });
    const save = (options: Electron.SaveDialogOptions) => {
      offered.push(options.defaultPath ?? '');
      return Promise.resolve({ canceled: false, filePath: target });
    };
    dialog.showSaveDialog = (first: unknown, second?: unknown) =>
      save((second ?? first) as Electron.SaveDialogOptions);
  }, filePath);
}

async function offeredSavePaths(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { offeredSavePaths: string[] }).offeredSavePaths,
  );
}

async function backToCampaignList(page: Page) {
  await page.getByRole('button', { name: 'Campagnes' }).click();
  await expect(page.getByRole('heading', { name: 'Vos campagnes' })).toBeVisible();
}

/** A Campaign named `name` holding one imported image, left closed on the Campaign list. */
async function campaignWithAnImage({ app, controlWindow }: RunningApp, name: string) {
  await createCampaign(controlWindow, name);
  await stubFilePicker(app, [fixture(`${IMAGE}.png`)]);
  await controlWindow.getByRole('button', { name: 'Importer des images' }).click();
  await expect(
    controlWindow.getByRole('list', { name: 'Images' }).getByRole('img', { name: IMAGE }),
  ).toBeVisible();
  await backToCampaignList(controlWindow);
}

async function campaignFolder(dataDir: string): Promise<string> {
  const [id] = await fs.readdir(path.join(dataDir, 'campaigns'));
  return path.join(dataDir, 'campaigns', id);
}

test('Exporter on the Campaign list saves a zip of its documents and Media', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await campaignWithAnImage(regie, 'Les Ombres: Tarsis');
  const folder = await campaignFolder(dataDir);
  const [mediaFile] = await fs.readdir(path.join(folder, 'media'));
  // Left by the app beside the documents: never part of an Export.
  await fs.writeFile(path.join(folder, 'scenes.json.tmp'), 'partial');
  const target = path.join(dataDir, 'Sauvegarde.zip');
  await stubSaveDialog(app, target);

  await controlWindow.getByRole('button', { name: 'Exporter Les Ombres: Tarsis' }).click();

  await expect(controlWindow.getByText('Campagne exportée.', { exact: true })).toBeVisible();
  const [offered] = await offeredSavePaths(app);
  expect(path.basename(offered)).toMatch(/^Les Ombres_ Tarsis – \d{4}-\d{2}-\d{2}\.zip$/);
  const entries = await readZipEntries(await fs.readFile(target));
  const names = entries.map((entry) => entry.name);
  expect(names[0]).toBe('regie-export.json');
  expect(names).toEqual(
    expect.arrayContaining(['campaign.json', 'media.json', `media/${mediaFile}`]),
  );
  expect(names.filter((name) => /\.(tmp|bak)$|^thumbnails\//.test(name))).toEqual([]);
  const image = entries.find((entry) => entry.name === `media/${mediaFile}`);
  expect(image?.method).toBe(0);
  expect(image?.content.equals(await fs.readFile(fixture(`${IMAGE}.png`)))).toBe(true);
  const manifest: unknown = JSON.parse(entries[0].content.toString('utf8'));
  expect(manifest).toMatchObject({
    format: 'regie-jdr-campaign-export',
    formatVersion: 1,
    campaignName: 'Les Ombres: Tarsis',
  });
});

test('an Export leaves Media missing on disk out and says how many', async ({ regie }) => {
  const { app, controlWindow, dataDir } = regie;
  await campaignWithAnImage(regie, 'Les Ombres');
  const folder = await campaignFolder(dataDir);
  const [mediaFile] = await fs.readdir(path.join(folder, 'media'));
  await fs.rm(path.join(folder, 'media', mediaFile));
  const target = path.join(dataDir, 'Sauvegarde.zip');
  await stubSaveDialog(app, target);

  await controlWindow.getByRole('button', { name: 'Exporter Les Ombres' }).click();

  await expect(
    controlWindow.getByText('Campagne exportée. 1 média introuvable n’a pas été inclus.'),
  ).toBeVisible();
  const names = (await readZipEntries(await fs.readFile(target))).map((entry) => entry.name);
  expect(names).toContain('campaign.json');
  expect(names.filter((name) => name.startsWith('media/'))).toEqual([]);
});
